/**
 * The Copilot's canned tasks (brief rule 27).
 *
 * Each is a fixed instruction the operator picks from a menu, so the common
 * questions are one click rather than a prompt someone has to compose. Free
 * text is still available; these are shortcuts, not a cage.
 *
 * Kept as data, in one place, so the sales team can see exactly what the
 * assistant was asked — and so a change to the wording is a reviewable diff.
 */

export interface CopilotTask {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly prompt: string;
}

export const COPILOT_TASKS: readonly CopilotTask[] = [
  {
    id: 'summary',
    label: '案件要約',
    description: 'これまでの経緯と現在の状況を短くまとめます',
    prompt:
      'この案件のこれまでの経緯と現在の状況を、5行程度で要約してください。' +
      '顧客情報・対応履歴・シミュレーション結果・見積の状況を取得してから答えてください。',
  },
  {
    id: 'today',
    label: '今日話す内容',
    description: '次の商談で話すべき論点を整理します',
    prompt:
      '次の商談で話すべき内容を、優先順位をつけて箇条書きにしてください。' +
      '直近の対応履歴と未完了タスク、次アクションを踏まえてください。',
  },
  {
    id: 'questions',
    label: 'ヒアリング質問',
    description: 'まだ聞けていないことを洗い出します',
    prompt:
      'この案件でまだ確認できていない情報を洗い出し、次回聞くべき質問を10個提案してください。' +
      '既に対応履歴に記録されている内容は除いてください。',
  },
  {
    id: 'talk',
    label: '営業トーク',
    description: 'シミュレーション結果を顧客向けの言葉にします',
    prompt:
      'シミュレーション結果をもとに、顧客に説明する営業トークを作成してください。' +
      '数値は必ずツールで取得した値を使い、単位を明記してください。' +
      '推定値であることが伝わる表現にしてください。',
  },
  {
    id: 'story',
    label: '提案ストーリー',
    description: '導入の理由を筋道立てて組み立てます',
    prompt:
      'この顧客に太陽光発電を導入いただく提案を、課題→解決→効果→次のステップの' +
      '流れで組み立ててください。効果の数値は取得した値のみを使ってください。',
  },
  {
    id: 'objection',
    label: '切り返し',
    description: 'よくある懸念への答え方を用意します',
    prompt:
      'この案件で想定される顧客の懸念・反対意見を5つ挙げ、それぞれへの回答案を' +
      '作成してください。ナレッジベースに根拠がある場合は出典を示してください。',
  },
  {
    id: 'competitor',
    label: '競合比較',
    description: '他社と比べたときの論点を整理します',
    prompt:
      'ナレッジベースの競合情報を検索し、他社と比較した際の強み・弱みを整理してください。' +
      'ナレッジベースに情報がない項目については、その旨を明記してください。',
  },
  {
    id: 'next-action',
    label: 'Next Action',
    description: '次にやるべきことを具体化します',
    prompt: 'この案件を前に進めるために次にやるべきことを3つ、期限の目安とともに提案してください。',
  },
  {
    id: 'follow-up-email',
    label: 'フォローメール',
    description: '商談後に送るメール文面を作ります',
    prompt:
      '直近の商談を踏まえたフォローアップメールの文面を作成してください。' +
      '件名と本文を分けて、そのまま送れる形にしてください。数値は取得した値のみ使ってください。',
  },
  {
    id: 'meeting-prep',
    label: '商談準備',
    description: '持っていくもの・確認することを列挙します',
    prompt: '次の商談に向けて、準備すべき資料と事前に確認しておくべき事項を列挙してください。',
  },
  {
    id: 'risk',
    label: '案件リスク',
    description: '失注につながりそうな要因を洗い出します',
    prompt:
      'この案件のリスク要因を洗い出してください。対応履歴の空白期間、未完了タスク、' +
      '未確定の情報などから、失注につながりうる点を具体的に指摘してください。',
  },
  {
    id: 'blockers',
    label: '受注阻害要因',
    description: '受注を止めているものを特定します',
    prompt:
      'この案件が受注に至っていない理由として考えられるものを、記録されている事実に' +
      '基づいて挙げてください。推測が含まれる場合はその旨を明記してください。',
  },
];

export function taskById(id: string): CopilotTask | undefined {
  return COPILOT_TASKS.find((t) => t.id === id);
}
