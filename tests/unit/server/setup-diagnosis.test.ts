import { describe, expect, it } from 'vitest';
import { diagnoseSetupFault } from '@server/setup-diagnosis';

/**
 * A half-configured deployment must say what is wrong.
 *
 * The generic "please try again later" was actively harmful here: the faults
 * below are deterministic, so waiting never helps, and the message sends the
 * operator away from the setting that would fix it.
 *
 * The other half of the contract is what the message must NOT contain. These
 * strings are shown on an unauthenticated screen, so a connection string, host,
 * user name or stack trace leaking into one would hand a probe exactly the map
 * it wants.
 */
describe('diagnoseSetupFault', () => {
  const cases: [string, unknown, string][] = [
    [
      'a missing connection string',
      new Error('DATABASE_URL is not set. Copy .env.example'),
      'DATABASE_URL',
    ],
    [
      'a refused connection',
      Object.assign(new Error('connect ECONNREFUSED 10.0.0.4:5432'), { code: 'ECONNREFUSED' }),
      '接続でき',
    ],
    [
      'an unresolvable host',
      Object.assign(new Error('getaddrinfo ENOTFOUND db.internal'), { code: 'ENOTFOUND' }),
      '接続でき',
    ],
    [
      'a rejected password',
      Object.assign(new Error('password authentication failed for user "solar"'), {
        code: '28P01',
      }),
      '認証',
    ],
    [
      'a missing database',
      Object.assign(new Error('database "solar_kanri" does not exist'), { code: '3D000' }),
      'データベース名',
    ],
    [
      'un-migrated tables',
      Object.assign(new Error('relation "User" does not exist'), { code: '42P01' }),
      'migrate deploy',
    ],
    [
      'Prisma P1001',
      Object.assign(new Error("Can't reach database server"), { code: 'P1001' }),
      '接続でき',
    ],
    [
      'Prisma P2021',
      Object.assign(new Error('The table does not exist'), { code: 'P2021' }),
      'migrate deploy',
    ],
  ];

  for (const [label, err, expected] of cases) {
    it(`recognises ${label}`, () => {
      const diagnosis = diagnoseSetupFault(err);
      expect(diagnosis).not.toBeNull();
      expect(diagnosis!.message).toContain(expected);
    });
  }

  it('reads a code nested inside a cause', () => {
    // The pg adapter wraps driver errors, so the code is rarely on the surface.
    const wrapped = new Error('Invalid `prisma.user.findUnique()` invocation', {
      cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    });
    expect(diagnoseSetupFault(wrapped)?.fault).toBe('database-unreachable');
  });

  it('never puts a connection string, host or credential in the message', () => {
    const leaky = new Error(
      'connect ECONNREFUSED postgresql://solar:hunter2@db.internal.example:5432/solar_kanri',
    );
    const message = diagnoseSetupFault(leaky)!.message;
    for (const secret of ['hunter2', 'db.internal.example', 'postgresql://', '5432', 'solar:']) {
      expect(message).not.toContain(secret);
    }
  });

  it('leaves an ordinary bug alone, so it is not mistaken for a misconfiguration', () => {
    // Sending someone to check environment variables that were fine all along
    // is its own kind of wasted afternoon.
    expect(diagnoseSetupFault(new TypeError('x.map is not a function'))).toBeNull();
    expect(
      diagnoseSetupFault(new Error('Unique constraint failed on the fields: (`email`)')),
    ).toBeNull();
    expect(diagnoseSetupFault(null)).toBeNull();
    expect(diagnoseSetupFault(undefined)).toBeNull();
  });
});
