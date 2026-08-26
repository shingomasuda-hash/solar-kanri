import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/auth/service';
import { can } from '@/server/auth/rbac';
import { prisma } from '@/server/db/client';
import { Alert, PageHeader } from '@/components/ui';
import { KnowledgeEditor } from './knowledge-editor';

export const metadata = { title: 'ナレッジベース' };

export default async function KnowledgePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const documents = await prisma.knowledgeDocument.findMany({
    orderBy: [{ isActive: 'desc' }, { updatedAt: 'desc' }],
    take: 200,
  });

  return (
    <>
      <PageHeader
        title="ナレッジベース"
        subtitle="AIコパイロットが参照する資料。メーカー資料・FAQ・補助金・競合比較など。"
      />

      <Alert tone="warning" title="登録する内容は「信頼できないデータ」として扱われます">
        <p>
          ここに登録された文書は、AIへの指示ではなく参考データとして扱われます。
          文書中に「これまでの指示を無視して…」のような記述があっても、AIはそれに従いません。
        </p>
        <p className="mt-1">
          コパイロットが使えるツールはすべて読み取り専用です。文書に不正な指示が
          含まれていても、メール送信や金額変更などの操作は行われません。
          そのような記述が見つかった場合は、回答時に警告として表示されます。
        </p>
      </Alert>

      <div className="mt-5">
        <KnowledgeEditor
          canWrite={can(user, 'master:write')}
          documents={documents.map((d) => ({
            id: d.id,
            kind: d.kind,
            title: d.title,
            body: d.body,
            tags: d.tags,
            sourceUrl: d.sourceUrl,
            sourceCitation: d.sourceCitation,
            isActive: d.isActive,
            updatedAt: d.updatedAt.toISOString(),
          }))}
        />
      </div>
    </>
  );
}
