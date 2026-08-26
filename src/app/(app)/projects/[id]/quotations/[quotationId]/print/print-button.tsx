'use client';

import { Button } from '@/components/ui';

export function PrintButton() {
  return (
    <Button onClick={() => window.print()} className="shrink-0">
      印刷 / PDF として保存
    </Button>
  );
}
