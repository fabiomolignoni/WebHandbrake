/**
 * Setting up a partner code. The secret is shown once, as a QR code and a key, dark on
 * white in every theme so that cameras read it; the code that the partner's app shows then proves
 * that the app has it.
 */

import { useState } from 'preact/hooks';
import { t } from '../../i18n/i18n';
import type { PartnerSetup } from '../../shared/models';
import { Banner, Button, Dialog, Field } from '../../ui/components';
import { qrMatrix } from '../../ui/qr';

/** A QR code of dark modules on white, with the quiet zone that scanners need. */
function QrCode({ text, label }: { text: string; label: string }) {
  const m = qrMatrix(text);
  const quiet = 4;
  const size = m.length + quiet * 2;
  let d = '';
  for (let y = 0; y < m.length; y++)
    for (let x = 0; x < m.length; x++) if (m[y][x]) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
  return (
    <svg
      class="qr"
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      shape-rendering="crispEdges"
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}

/** The secret in groups of four characters, as authenticator apps show setup keys. */
const groupKey = (secret: string) => secret.replace(/(.{4})(?=.)/g, '$1 ');

/**
 * The setup dialog: the QR code and the key, shown once, then the code that the partner's app
 * shows. `onConfirm` checks the code and returns the error to show, or null when it is done.
 */
export function PartnerSetupDialog({
  setup,
  name,
  initialBreaks,
  hasBreaks = true,
  onConfirm,
  onClose,
}: {
  setup: PartnerSetup;
  name: string;
  initialBreaks: boolean;
  /** Whether the rule has breaks: only then is the partner's code for them asked about. */
  hasBreaks?: boolean;
  onConfirm: (code: string, breaks: boolean) => Promise<string | null>;
  onClose: () => void;
}) {
  const [code, setCode] = useState('');
  const [breaks, setBreaks] = useState(initialBreaks);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      setError(await onConfirm(code, breaks));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('partner.dialogTitle', { name })}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={busy || code.replace(/\s/g, '').length !== 6} onClick={confirm}>
            {t('partner.confirm')}
          </Button>
        </>
      }
    >
      <form
        class="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void confirm();
        }}
      >
        <p class="small">{t('partner.scan')}</p>
        <QrCode text={setup.uri} label={t('partner.qrLabel')} />
        <Field label={t('partner.keyLabel')}>
          {(id) => (
            <output id={id} class="mono partner-key">
              {groupKey(setup.secret)}
            </output>
          )}
        </Field>
        <Banner kind="warning">{t('partner.once')}</Banner>
        <Field label={t('partner.codeLabel')} help={t('partner.codeHelp')}>
          {(id, d) => (
            <input
              id={id}
              aria-describedby={d}
              class="input num"
              inputMode="numeric"
              autoComplete="off"
              maxLength={7}
              value={code}
              onInput={(e) => setCode((e.target as HTMLInputElement).value)}
            />
          )}
        </Field>
        {hasBreaks && (
          <label class="check small">
            <input
              type="checkbox"
              checked={breaks}
              onChange={(e) => setBreaks((e.target as HTMLInputElement).checked)}
            />
            {t('partner.breaks')}
          </label>
        )}
        {error && <Banner kind="danger">{error}</Banner>}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
