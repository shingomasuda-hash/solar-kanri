import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Service-layer integration tests, against a real PostgreSQL database.
 *
 * These cover the things neither a unit test nor a browser test can prove:
 *
 *  - **Transaction boundaries.** A unit test cannot show that a failed project
 *    insert rolls back the property created alongside it; only the database
 *    can. This is the regression guard for the finding that the design page
 *    used to create properties during render (docs/security-review.md, S-1).
 *  - **Ownership scoping at the query level.** The browser suite proves the UI
 *    hides what a user may not see. That is not access control. These tests
 *    call the services directly, as a compromised or mistaken caller would.
 *  - **Audit and immutability**, which are database state, not UI state.
 *
 * They are skipped, not failed, when `DATABASE_URL` is absent, so the suite
 * still runs on a machine without Postgres. Every import is deferred for the
 * same reason: `src/server/db/client` constructs its pool at module load.
 */

const HAS_DB = Boolean(process.env.DATABASE_URL);

type Services = {
  prisma: (typeof import('@server/db/client'))['prisma'];
  projects: typeof import('@server/services/projects');
  quotations: typeof import('@server/services/quotations');
  dashboard: typeof import('@server/services/dashboard');
  rbac: typeof import('@server/auth/rbac');
};

type SessionUser = import('@server/auth/session').SessionUser;

/** Everything this suite creates is prefixed so cleanup can never over-delete. */
const PREFIX = 'itest-service-layer';

describe.skipIf(!HAS_DB)('service layer (integration)', () => {
  let s: Services;
  let salesA: SessionUser;
  let salesB: SessionUser;
  let admin: SessionUser;
  let customerId: string;
  let statusId: string;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    const [prismaMod, projects, quotations, dashboard, rbac] = await Promise.all([
      import('@server/db/client'),
      import('@server/services/projects'),
      import('@server/services/quotations'),
      import('@server/services/dashboard'),
      import('@server/auth/rbac'),
    ]);
    s = { prisma: prismaMod.prisma, projects, quotations, dashboard, rbac };

    const status = await s.prisma.salesStatus.findFirst({
      where: { isActive: true, isWon: false, isLost: false },
      orderBy: { sortOrder: 'asc' },
    });
    if (!status) {
      throw new Error(
        'No sales statuses found. Run `npm run db:seed` before the integration tests.',
      );
    }
    statusId = status.id;

    const makeUser = async (suffix: string, role: 'SALES' | 'ADMIN'): Promise<SessionUser> => {
      const user = await s.prisma.user.create({
        data: {
          email: `${PREFIX}-${suffix}@example.invalid`,
          name: `${PREFIX} ${suffix}`,
          // Never used for login: these tests call services directly. A value
          // that cannot be a bcrypt hash is deliberate, so nothing can sign in
          // as them even if cleanup fails.
          passwordHash: 'integration-test-account-no-login',
          role,
        },
      });
      createdUserIds.push(user.id);
      return { id: user.id, email: user.email, name: user.name, role: user.role };
    };

    salesA = await makeUser('sales-a', 'SALES');
    salesB = await makeUser('sales-b', 'SALES');
    admin = await makeUser('admin', 'ADMIN');

    const customer = await s.prisma.customer.create({
      data: {
        code: `${PREFIX}-C`,
        type: 'INDIVIDUAL',
        name: `${PREFIX} 顧客`,
        prefecture: '東京都',
        city: '千代田区',
        addressLine: '1-1',
      },
    });
    customerId = customer.id;
  });

  afterAll(async () => {
    if (!HAS_DB || !s) return;
    // Order matters: Project→Customer is Restrict, and audit rows only
    // null out their user, so they would otherwise outlive the suite.
    await s.prisma.auditLog.deleteMany({ where: { userId: { in: createdUserIds } } });
    await s.prisma.project.deleteMany({ where: { customerId } });
    await s.prisma.customer.deleteMany({ where: { id: customerId } });
    await s.prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  /**
   * A minimal valid project input. Optional fields are omitted rather than set
   * to null: the schema accepts either, and omission is what a form that never
   * rendered the field actually sends.
   */
  const newProject = (title: string, overrideStatusId?: string) => ({
    title,
    customerId,
    statusId: overrideStatusId ?? statusId,
  });

  describe('createProject', () => {
    it('creates the property in the same transaction, so the design page never has to write', async () => {
      const project = await s.projects.createProject(salesA, newProject(`${PREFIX} 物件つき案件`));

      expect(project.propertyId).not.toBeNull();
      const property = await s.prisma.property.findUniqueOrThrow({
        where: { id: project.propertyId! },
      });
      // The address is carried over from the customer, so the design page has
      // something to geocode without a second round of data entry.
      expect(property.customerId).toBe(customerId);
      expect(property.prefecture).toBe('東京都');
    });

    it('leaves no orphan property behind when the project insert fails', async () => {
      const before = await s.prisma.property.count({ where: { customerId } });

      // A cuid-shaped status that does not exist: passes validation, fails the
      // foreign key — which is exactly the shape of a real partial failure.
      await expect(
        s.projects.createProject(
          salesA,
          newProject(`${PREFIX} ロールバック`, 'claaaaaaaaaaaaaaaaaaaaaaa'),
        ),
      ).rejects.toThrow();

      const after = await s.prisma.property.count({ where: { customerId } });
      expect(after).toBe(before);
    });

    it('writes an audit record naming the actor and the entity', async () => {
      const project = await s.projects.createProject(salesA, newProject(`${PREFIX} 監査`));

      const audit = await s.prisma.auditLog.findFirst({
        where: { entityType: 'Project', entityId: project.id, action: 'project.create' },
      });
      expect(audit).not.toBeNull();
      expect(audit!.userId).toBe(salesA.id);
    });
  });

  describe('ownership scoping', () => {
    let ownedByA: string;

    beforeAll(async () => {
      const project = await s.projects.createProject(salesA, newProject(`${PREFIX} A の案件`));
      ownedByA = project.id;
    });

    it('hides another salesperson’s project from the list', async () => {
      const listB = await s.projects.listProjects(salesB, { take: 200 });
      expect(listB.map((p) => p.id)).not.toContain(ownedByA);

      const listA = await s.projects.listProjects(salesA, { take: 200 });
      expect(listA.map((p) => p.id)).toContain(ownedByA);
    });

    it('refuses a direct read by id, not just a listing', async () => {
      // The interesting case: the UI never offers this link, so only a
      // service-level check stops someone who guesses or keeps an old URL.
      await expect(s.projects.getProject(salesB, ownedByA)).rejects.toBeInstanceOf(
        s.rbac.ForbiddenError,
      );
    });

    it('lets an administrator read it', async () => {
      const project = await s.projects.getProject(admin, ownedByA);
      expect(project?.id).toBe(ownedByA);
    });

    it('scopes the dashboard to the viewer’s own pipeline', async () => {
      const forA = await s.dashboard.getDashboard(salesA);
      const forB = await s.dashboard.getDashboard(salesB);

      expect(forA.activeProjects).toBeGreaterThan(0);
      expect(forB.activeProjects).toBe(0);
    });
  });

  describe('quotation immutability', () => {
    const draft = (projectId: string, title: string) => ({
      projectId,
      title,
      discountJpy: 0,
      subsidyJpy: 0,
      taxRate: 0.1,
      items: [
        {
          category: 'PANEL' as const,
          name: 'パネル',
          quantity: 10,
          unit: '枚',
          unitPriceJpy: 40_000,
        },
      ],
    });

    it('refuses to change an issued quotation, and keeps its figures', async () => {
      const project = await s.projects.createProject(admin, newProject(`${PREFIX} 見積`));

      const quotation = await s.quotations.createQuotation(
        admin,
        draft(project.id, `${PREFIX} 見積 v1`),
      );
      expect(quotation.subtotalJpy).toBe(400_000);
      expect(quotation.totalJpy).toBe(440_000);

      await s.quotations.issueQuotation(admin, quotation.id);

      await expect(
        s.quotations.updateQuotation(admin, quotation.id, {
          ...draft(project.id, `${PREFIX} 見積 v1 改`),
          items: [
            {
              category: 'PANEL' as const,
              name: 'パネル',
              quantity: 10,
              unit: '枚',
              unitPriceJpy: 10_000,
            },
          ],
        }),
      ).rejects.toBeInstanceOf(s.quotations.QuotationLockedError);

      const after = await s.prisma.quotation.findUniqueOrThrow({ where: { id: quotation.id } });
      expect(after.totalJpy).toBe(440_000);
      expect(after.status).toBe('ISSUED');
    });

    it('does not let a sales user issue one', async () => {
      const project = await s.projects.createProject(salesA, newProject(`${PREFIX} 営業の見積`));
      const quotation = await s.quotations.createQuotation(
        salesA,
        draft(project.id, `${PREFIX} 営業見積`),
      );

      await expect(s.quotations.issueQuotation(salesA, quotation.id)).rejects.toBeInstanceOf(
        s.rbac.ForbiddenError,
      );
    });
  });
});
