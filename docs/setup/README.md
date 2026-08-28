# Setup

Work through these in order. The system is usable after step 3; steps 4 and 5
add convenience and are not required.

| Step | Guide                                        | Required?                                          |
| ---- | -------------------------------------------- | -------------------------------------------------- |
| 1    | [Database](./database.md)                    | Yes                                                |
| 2    | Copy `.env.example` to `.env` and fill it in | Yes                                                |
| 3    | Enter sourced coefficients in 管理 → 係数    | **Yes — nothing can be quoted until this is done** |
| 4    | [Google Maps Platform](./google-maps.md)     | No — roof outlines can be entered as coordinates   |
| 5    | [AI Copilot](./ai-provider.md)               | No — everything else works without it              |

## Quick start

```bash
npm install
cp .env.example .env        # then edit it
npm run db:migrate
npm run db:seed
npm run dev
```

Open <http://localhost:3000> and sign in as `admin@example.com` with your
`SEED_ADMIN_PASSWORD`.

## What you will see first

管理 → システム状態 will report the calculation engine as **停止**, because every
seeded coefficient is an unverified placeholder. This is correct: the engines
refuse to produce a number from values nobody has sourced.

Go to 管理 → 係数 and, for each entry, record the value and where it came from —
a manufacturer datasheet, a published standard, an official dataset, or a
documented decision by your company. Do the same in 管理 → 電力単価 and
管理 → 日射量. The health page turns green when nothing is left unsourced, and
simulation becomes available at that moment.

The outstanding items and who has to decide them are listed in
`docs/open-issues.md`.

## Verifying an install

```bash
npm run gate    # format, lint, typecheck, unit + regression tests, build, E2E
```

- [`deployment.md`](deployment.md) — Vercel などへのデプロイ、環境変数、マイグレーション

## 日射量データ

管理 → 日射量 の「PVGIS から取得して登録」で、緯度経度を入れれば月別日射量と気温を
取得して観測点として保存できます。APIキーは不要です（欧州委員会 JRC の公開サービス）。

保存する理由は2つあります。シミュレーションのたびに外部へ取りに行くと、そのサービスが
翌年に値を変えたとき、**今日発行した見積の数値が後から書き換わります**。もう1つは、
保存された値は管理者が読めて、国内データセットと突き合わせて差し替えられることです。

PVGIS は再解析データなので、本格運用では NEDO METPV / MONSOLA などと突き合わせて
確認してください。出典欄にもその注意書きが入ります。
