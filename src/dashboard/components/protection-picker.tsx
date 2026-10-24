/**
 * The protection of a rule, one of six, chosen in the wizard, the rule editor and
 * first run. A password is hashed and a partner code checked in the background before they are
 * kept in the draft; Locked and Permanent are chosen after a preview. Saving the draft
 * classifies the new protection like any other change.
 */

import { useState } from 'preact/hooks';
import { DEFAULT_PROTECTION, firmProtection } from '../../engine/defaults';
import {
  MAX_WAIT_SECONDS,
  MIN_WAIT_SECONDS,
  WAIT_CHOICES_SECONDS,
  WAIT_IN_DIALOG_SECONDS,
} from '../../engine/limits';
import type { Protection, ProtectionKind } from '../../engine/types';
import { t } from '../../i18n/i18n';
import { formatDateTime, formatDuration } from '../../shared/format';
import type { PartnerSetup } from '../../shared/models';
import { call } from '../../shared/rpc';
import { Button, Dialog, DurationInput, Field, RadioCards, Segmented, toast } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { protectionIcon } from '../../ui/protection';
import { useDashboard } from '../context';
import { PartnerSetupDialog } from './partner-setup';
import { PasswordDialog } from './password-dialog';

export { protectionIcon, protectionLabel } from '../../ui/protection';

/** The value of the "Other" choice among the waits. */
const OTHER_WAIT = -1;

export const PROTECTION_KINDS: ProtectionKind[] = [
  'reminder',
  'wait',
  'password',
  'partner',
  'locked',
  'permanent',
];

/**
 * What loosening the rule will take; and, for a firm protection, that the browser's extension and
 * settings pages are blocked while it restricts. What a break costs is chosen with the breaks.
 */
export function ProtectionExplanation({
  protection: p,
  browserPages,
}: {
  protection: Protection;
  /** Whether a firmly protected rule blocks the browser's extension and settings pages. */
  browserPages: boolean;
}) {
  const weaken =
    p.kind === 'wait'
      ? t(p.seconds > WAIT_IN_DIALOG_SECONDS ? 'level.wait.weakenLong' : 'level.wait.weakenShort', {
          duration: formatDuration(p.seconds),
        })
      : t(`level.${p.kind}.weaken`);
  return (
    <ul class="small bullets">
      <li>{weaken}</li>
      {browserPages && firmProtection(p) && <li>{t('level.firm.browserPages')}</li>}
    </ul>
  );
}

/**
 * Just-in-time explanation before choosing Locked, with its end date, or Permanent, which
 * has none: only the emergency exit ends it.
 */
export function LockedPreview({
  kind,
  onCancel,
  onConfirm,
}: {
  kind: 'locked' | 'permanent';
  onCancel: () => void;
  onConfirm: (p: Protection) => void;
}) {
  const [date, setDate] = useState(() => {
    const d = new Date(Date.now() + 7 * 86_400_000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [ack, setAck] = useState(false);
  const permanent = kind === 'permanent';
  const until = new Date(`${date}T00:00`).getTime();
  return (
    <Dialog
      open
      onClose={onCancel}
      title={permanent ? t('permanent.title') : t('locked.title')}
      actions={
        <>
          <Button variant="primary" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={!ack || (!permanent && !(until > Date.now()))}
            onClick={() => onConfirm(permanent ? { kind: 'permanent' } : { kind: 'locked', until })}
          >
            {permanent ? t('permanent.confirm') : t('locked.confirm')}
          </Button>
        </>
      }
    >
      <div class="stack">
        <p>{permanent ? t('permanent.body') : t('locked.body')}</p>
        <ul class="small bullets">
          <li>{t('locked.point1')}</li>
          <li>{t('locked.point2')}</li>
          <li>{permanent ? t('permanent.point3') : t('locked.point3')}</li>
        </ul>
        {!permanent && (
          <Field label={t('locked.until')}>
            {(fid) => (
              <input
                id={fid}
                type="date"
                class="input inline"
                value={date}
                onInput={(e) => setDate((e.target as HTMLInputElement).value)}
              />
            )}
          </Field>
        )}
        <label class="check">
          <input
            type="checkbox"
            checked={ack}
            onChange={(e) => setAck((e.target as HTMLInputElement).checked)}
          />
          {permanent ? t('permanent.ack') : t('locked.ack')}
        </label>
      </div>
    </Dialog>
  );
}

export function ProtectionPicker({
  value,
  onChange,
  groupId,
  name,
  label,
  breaks,
}: {
  /** The protection chosen, or null while none is (active choice). */
  value: Protection | null;
  onChange: (p: Protection) => void;
  /** The rule, or the draft of one, that a partner code is set up for. */
  groupId: string;
  /** Its name, for the password dialog and the partner's app. */
  name: string;
  label: string;
  /** Whether the rule allows breaks: only then can they need the partner's code too. */
  breaks: boolean;
}) {
  // Each kind keeps what was chosen for it, so that going back to a password or a partner code
  // does not ask for them again.
  const [kept, setKept] = useState<Partial<Record<ProtectionKind, Protection>>>(() =>
    value ? { [value.kind]: value } : {},
  );
  const { model } = useDashboard();
  const browserPages = !model.platform.android && model.config.settings.protection.internalPages === 'auto';
  const [dialog, setDialog] = useState<'password' | 'locked' | 'permanent' | null>(null);
  const [setup, setSetup] = useState<PartnerSetup | null>(null);
  // "Other" is chosen, even when the wait typed equals one of the usual ones.
  const [customWait, setCustomWait] = useState(false);
  const choose = (p: Protection) => {
    setKept((k) => ({ ...k, [p.kind]: p }));
    onChange(p);
  };
  const setUpPartner = async () => setSetup(await call('partner.begin', { groupId, name }));
  // A new rule is named in Details, after its protection: until then titles have a placeholder.
  const title = name.trim() || t('editor.unnamed');
  const pick = (kind: ProtectionKind) => {
    const before = kept[kind];
    if (before) return choose(before);
    if (kind === 'reminder') choose({ kind: 'reminder' });
    else if (kind === 'wait') choose({ ...DEFAULT_PROTECTION });
    else if (kind === 'partner') void setUpPartner();
    else setDialog(kind);
  };
  const otherWait = value?.kind === 'wait' && (customWait || !WAIT_CHOICES_SECONDS.includes(value.seconds));

  return (
    <div class="stack">
      <RadioCards<ProtectionKind>
        value={value?.kind ?? ('' as ProtectionKind)}
        onChange={pick}
        label={label}
        class="level-grid"
        itemClass="choice"
        options={PROTECTION_KINDS.map((k) => ({ value: k }))}
        render={(o) => (
          <>
            <Icon name={protectionIcon(o.value)} />
            <span class="stack stack-xs">
              <strong>{t(`level.${o.value}`)}</strong>
              <span class="small text-2">{t(`level.${o.value}.desc`)}</span>
            </span>
          </>
        )}
      />
      {value && (
        <div class="option-panel stack stack-sm" aria-live="polite">
          <ProtectionExplanation protection={value} browserPages={browserPages} />
          {value.kind === 'wait' && (
            <div class="stack stack-xs">
              <span class="label" id={`wait-${groupId}`}>
                {t('protection.waitLabel')}
              </span>
              <Segmented<number>
                value={otherWait ? OTHER_WAIT : value.seconds}
                onChange={(seconds) => {
                  setCustomWait(seconds === OTHER_WAIT);
                  if (seconds !== OTHER_WAIT) choose({ kind: 'wait', seconds });
                }}
                labelledBy={`wait-${groupId}`}
                options={[
                  ...WAIT_CHOICES_SECONDS.map((s) => ({ value: s, label: formatDuration(s) })),
                  { value: OTHER_WAIT, label: t('protection.waitOther') },
                ]}
              />
              {otherWait && (
                <DurationInput
                  value={value.seconds}
                  base="seconds"
                  units={['seconds', 'minutes', 'hours', 'days']}
                  min={MIN_WAIT_SECONDS}
                  max={MAX_WAIT_SECONDS}
                  label={t('protection.waitCustom')}
                  onChange={(seconds) => choose({ kind: 'wait', seconds })}
                />
              )}
              <span class="help">
                {t('protection.waitHelp', { duration: formatDuration(WAIT_IN_DIALOG_SECONDS) })}
              </span>
            </div>
          )}
          {value.kind === 'password' && (
            <div class="row">
              <span class="small grow">{t('protection.passwordSet')}</span>
              <Button size="small" onClick={() => setDialog('password')}>
                {t('access.change')}
              </Button>
            </div>
          )}
          {value.kind === 'partner' && (
            <>
              {breaks && (
                <label class="check small">
                  <input
                    type="checkbox"
                    checked={value.breaks}
                    onChange={(e) => choose({ ...value, breaks: (e.target as HTMLInputElement).checked })}
                  />
                  {t('partner.breaks')}
                </label>
              )}
              <div class="row">
                <span class="small grow">{t('protection.partnerSet')}</span>
                <Button size="small" onClick={() => void setUpPartner()}>
                  {t('partner.change')}
                </Button>
              </div>
            </>
          )}
          {value.kind === 'locked' && (
            <div class="row">
              <span class="small grow">{t('editor.lockedUntil', { when: formatDateTime(value.until) })}</span>
              <Button size="small" onClick={() => setDialog('locked')}>
                {t('protection.lockedChange')}
              </Button>
            </div>
          )}
        </div>
      )}
      {dialog === 'password' && (
        <PasswordDialog
          title={t('editor.passwordTitle', { name: title })}
          help={t('editor.passwordHelp')}
          onSave={async (password) => {
            setDialog(null);
            choose({ kind: 'password', hash: (await call('password.hash', { password })).hash });
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {(dialog === 'locked' || dialog === 'permanent') && (
        <LockedPreview
          kind={dialog}
          onCancel={() => setDialog(null)}
          onConfirm={(p) => {
            setDialog(null);
            choose(p);
          }}
        />
      )}
      {setup && (
        <PartnerSetupDialog
          setup={setup}
          name={title}
          initialBreaks={value?.kind === 'partner' ? value.breaks : false}
          hasBreaks={breaks}
          onConfirm={async (code, breaks) => {
            const r = await call('partner.verify', { groupId, code, breaks });
            if ('error' in r) return r.error;
            setSetup(null);
            choose(r.partner);
            toast(t('partner.done'));
            return null;
          }}
          onClose={() => setSetup(null)}
        />
      )}
    </div>
  );
}
