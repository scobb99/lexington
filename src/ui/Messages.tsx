// Message line and notices (Build Spec v2.0, Section 12).
// Every action gives a short, friendly message naming the specific reason.

import { useState } from 'react';
import { useGame } from '../game/store';
import type { GameMessage } from '../game/types';

/**
 * One message. On a phone the line is clamped to 3 lines to keep the map visible;
 * tapping it shows the whole message. A new message starts clamped again (it is keyed by id).
 */
function MessageLine({ message }: { message: GameMessage }) {
  const [open, setOpen] = useState(false);
  return (
    <p
      className={`message message-${message.kind}${open ? ' message-open' : ''}`}
      role="status"
      aria-live="polite"
      onClick={() => setOpen((o) => !o)}
    >
      {message.text}
    </p>
  );
}

export function Messages() {
  const message = useGame((s) => s.message);
  const notice = useGame((s) => s.notice);
  const dictStatus = useGame((s) => s.dict.status);
  const dictCount = useGame((s) => s.dict.count);

  return (
    <div className="messages" data-tour="message">
      <MessageLine key={message.id} message={message} />
      {notice && (
        <p className="notice" role="alert">
          {notice}
        </p>
      )}
      <p className="dict-status">
        Word list:{' '}
        {dictStatus === 'loading'
          ? 'loading…'
          : dictStatus === 'ready'
            ? `${dictCount.toLocaleString()} words`
            : `backup list (${dictCount} words)`}
      </p>
    </div>
  );
}
