'use client';

import { useActionState } from 'react';
import { setDefaultCoefficientSetAction, type FormState } from '../actions';
import { Alert, Button } from '@/components/ui';

/**
 * Makes one coefficient set the one the simulator uses.
 *
 * Present because leaving demonstration mode has to be possible from the
 * console. Without it the only way back is editing the database by hand, which
 * this project does not allow.
 */
export function DefaultSetButton({ id, name }: { id: string; name: string }) {
  const [state, action] = useActionState(setDefaultCoefficientSetAction, {} as FormState);
  return (
    <form action={action} className="inline">
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="secondary" className="text-xs">
        このセットを既定にする
      </Button>
      <span className="sr-only">{name}</span>
      {state.error && (
        <div className="mt-2">
          <Alert tone="danger">{state.error}</Alert>
        </div>
      )}
    </form>
  );
}
