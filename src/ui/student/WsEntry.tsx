import { useState } from "react";
import { WS_MAX_LEN, WsSchema } from "../../schemas/ws";

/**
 * Typed workstation ID. Shown on first launch with nothing to go on (a Home Screen web app on
 * iPadOS lands here whenever it was added without `?ws=`: its storage is isolated from Safari's),
 * and again when the student taps the ID in the status bar to fix a typo. The teacher keeps IDs
 * unique in the room; a repeated ID simply takes over the earlier pairing.
 */
export function WsEntry({
  initial = "",
  urlInvalid = false,
  onConfirm,
  onCancel,
}: {
  initial?: string;
  urlInvalid?: boolean;
  onConfirm: (ws: string) => void;
  onCancel?: () => void;
}) {
  const [value, setValue] = useState(initial);
  const parsed = WsSchema.safeParse(value);
  const issue =
    !parsed.success && value.trim() !== "" ? parsed.error.issues[0]?.message : undefined;
  return (
    <div className="center">
      <h1>Which workstation is this iPad?</h1>
      {urlInvalid && (
        <p className="meta" data-ws-notice>
          The ?ws value in this URL is not a valid workstation ID.
        </p>
      )}
      <form
        className="ws-entry"
        onSubmit={(e) => {
          e.preventDefault();
          if (parsed.success) onConfirm(parsed.data);
        }}
      >
        <input
          data-ws-input
          aria-label="Workstation ID"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={WS_MAX_LEN}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          inputMode="text"
          placeholder="e.g. Row 2"
        />
        <button type="submit" data-ws-confirm disabled={!parsed.success}>
          Connect
        </button>
        {onCancel && (
          <button type="button" className="secondary" data-ws-cancel onClick={onCancel}>
            Cancel
          </button>
        )}
      </form>
      {issue && (
        <p className="meta" data-ws-issue>
          {issue}
        </p>
      )}
      <p className="meta">Letters, digits, spaces, - and _. Pick once; this iPad remembers it.</p>
    </div>
  );
}
