// The Saves panel (Build Spec v2.0, Sections 11 and 16): the autosave, three manual slots,
// Export and Import of one JSON file, and New Town. Opened from the in-game menu, or from the
// title screen, where it shows Slots 1 to 3 with Load, Export and Import (loading a slot or
// importing a file enters the town). Loading or importing replaces the current town, so in a
// town those ask once before doing it.

import { useEffect, useRef, useState, useSyncExternalStore, type ChangeEvent, type PointerEvent as ReactPointerEvent } from 'react';
import {
  MANUAL_SLOTS,
  SLOT_NAMES,
  checkImportFile,
  exportSlot,
  exportTown,
  exportUnreadable,
  flushPendingAutosave,
  formatWhen,
  getSaveStatus,
  importChecked,
  listSlots,
  loadFromSlot,
  saveToSlot,
  subscribeSaveStatus,
  type SlotId,
  type SlotInfo,
} from '../game/persistence';
import type { MigrationNotes, SaveData } from '../game/save';
import { useGame } from '../game/store';
import { setUi, useUi } from './uiState';

export function openSaves(): void {
  setUi({ savesOpen: true });
}

type Confirm =
  | { kind: 'load'; id: SlotId }
  | { kind: 'replace'; id: SlotId }
  | { kind: 'import'; save: SaveData; notes: MigrationNotes; fileName: string }
  | null;

type Note = { kind: 'ok' | 'warn'; text: string } | null;

const close = () => setUi({ savesOpen: false });

export function SaveDialog() {
  const isOpen = useUi((u) => u.savesOpen);
  const mode = useGame((s) => s.mode);
  const onTitle = mode === 'title';
  const status = useSyncExternalStore(subscribeSaveStatus, getSaveStatus);
  const [slots, setSlots] = useState<SlotInfo[] | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [note, setNote] = useState<Note>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Re-read the slots whenever the panel opens or a slot changes. A waiting autosave is
  // written first, so the Autosave row shows the town as it is now.
  useEffect(() => {
    if (!isOpen) return;
    let live = true;
    void flushPendingAutosave()
      .then(() => listSlots())
      .then((s) => {
        if (live) setSlots(s);
      });
    return () => {
      live = false;
    };
  }, [isOpen, status.revision, status.lastAutosave]);

  // Fresh panel each time it opens; Escape closes it.
  useEffect(() => {
    if (!isOpen) return;
    setConfirm(null);
    setNote(null);
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen]);

  if (!isOpen) return null;

  const run = async (job: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await job();
    } finally {
      setBusy(false);
    }
  };

  const doSave = (id: SlotId) =>
    run(async () => {
      setConfirm(null);
      const ok = await saveToSlot(id);
      setNote(ok ? { kind: 'ok', text: `Saved to ${SLOT_NAMES[id]}.` } : { kind: 'warn', text: 'That save did not work. Use Export to keep a copy.' });
    });

  const doLoad = (id: SlotId) =>
    run(async () => {
      setConfirm(null);
      const r = await loadFromSlot(id);
      if (r.ok) close();
      else setNote({ kind: 'warn', text: r.reason ?? 'That slot could not be loaded.' });
    });

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // so choosing the same file again still works
    if (!file) return;
    void run(async () => {
      const r = await checkImportFile(file);
      if (r.ok) {
        setNote(null);
        if (onTitle) {
          await importChecked(r.save, file.name, r.notes);
          close();
        } else setConfirm({ kind: 'import', save: r.save, notes: r.notes, fileName: file.name });
      } else {
        setConfirm(null);
        setNote({ kind: 'warn', text: `${file.name} was not loaded. ${r.reason}${onTitle ? '' : ' Your current town is unchanged.'}` });
      }
    });
  };

  const doImport = (save: SaveData, notes: MigrationNotes, fileName: string) =>
    run(async () => {
      setConfirm(null);
      await importChecked(save, fileName, notes);
      close();
    });

  const autosave = slots?.find((s) => s.id === 'autosave');
  const statusLine = !status.available
    ? status.lastError
    : status.autosavePaused
      ? status.autosavePaused
      : `Autosave is on: your town saves itself a second after every change${
          status.lastAutosave ? `. Last saved ${formatWhen(status.lastAutosave)}.` : autosave?.savedAt ? `. Last saved ${formatWhen(autosave.savedAt)}.` : '.'
        }`;

  return (
    <div className="dialog-backdrop" onPointerDown={(e: ReactPointerEvent<HTMLDivElement>) => e.target === e.currentTarget && close()}>
      <div className="dialog saves" role="dialog" aria-modal="true" aria-labelledby="saves-title" tabIndex={-1} ref={panelRef}>
        <div className="dialog-head">
          <h2 id="saves-title">Saves</h2>
          <button className="pill" onClick={close}>
            Close
          </button>
        </div>

        {!onTitle && <p className={`saves-status${!status.available || status.autosavePaused ? ' saves-status-warn' : ''}`}>{statusLine}</p>}

        <ul className="slot-list">
          {autosave && !onTitle && (
            <li className="slot slot-auto">
              <div className="slot-info">
                <span className="slot-name">Autosave</span>
                <span className="slot-summary">
                  {autosave.state === 'ok'
                    ? `${autosave.summary}${autosave.savedAt ? ` · ${formatWhen(autosave.savedAt)}` : ''}`
                    : autosave.state === 'empty'
                      ? 'Nothing saved yet'
                      : autosave.state === 'bad'
                        ? 'Could not be read'
                        : 'Not available'}
                </span>
              </div>
              <span className="slot-hint">Your current town</span>
            </li>
          )}
          {MANUAL_SLOTS.map((id) => {
            const info = slots?.find((s) => s.id === id);
            const filled = info?.state === 'ok';
            const asking = confirm && confirm.kind !== 'import' && confirm.id === id ? confirm : null;
            return (
              <li key={id} className="slot" data-slot={id}>
                <div className="slot-info">
                  <span className="slot-name">{SLOT_NAMES[id]}</span>
                  <span className="slot-summary">
                    {!info
                      ? '…'
                      : filled
                        ? `${info.summary}${info.savedAt ? ` · ${formatWhen(info.savedAt)}` : ''}`
                        : info.state === 'empty'
                          ? 'Empty'
                          : info.state === 'bad'
                            ? `Could not be read: ${info.reason}`
                            : 'Not available'}
                  </span>
                </div>
                {asking ? (
                  <div className="slot-confirm">
                    <span>{asking.kind === 'load' ? `Load ${SLOT_NAMES[id]}? Your current town will be replaced.` : `Replace what's in ${SLOT_NAMES[id]}?`}</span>
                    <button className="pill pill-primary" disabled={busy} onClick={() => (asking.kind === 'load' ? doLoad(id) : doSave(id))}>
                      {asking.kind === 'load' ? 'Yes, load it' : 'Yes, replace'}
                    </button>
                    <button className="pill" onClick={() => setConfirm(null)}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="slot-actions">
                    {!onTitle && (
                      <button className="pill" disabled={busy || !status.available} onClick={() => (filled ? setConfirm({ kind: 'replace', id }) : doSave(id))}>
                        {filled ? 'Replace' : 'Save here'}
                      </button>
                    )}
                    <button className="pill" disabled={busy || !filled} onClick={() => (onTitle ? doLoad(id) : setConfirm({ kind: 'load', id }))}>
                      Load
                    </button>
                    {onTitle && (
                      <button className="pill" disabled={busy || !filled} onClick={() => void exportSlot(id)}>
                        Export
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {note && (
          <p className={`saves-note saves-note-${note.kind}`} role="status">
            {note.text}
          </p>
        )}

        <section className="saves-file">
          <h3>Town file</h3>
          <p>{onTitle ? 'Import loads a town file and enters that town.' : 'Export downloads your town as one file. Import loads a file like that back in.'}</p>
          {confirm?.kind === 'import' ? (
            <div className="slot-confirm">
              <span>Load the town from {confirm.fileName}? Your current town will be replaced.</span>
              <button className="pill pill-primary" disabled={busy} onClick={() => doImport(confirm.save, confirm.notes, confirm.fileName)}>
                Yes, load it
              </button>
              <button className="pill" onClick={() => setConfirm(null)}>
                Cancel
              </button>
            </div>
          ) : (
            <div className="slot-actions">
              {!onTitle && (
                <button className="pill" onClick={exportTown}>
                  Export
                </button>
              )}
              <button className="pill" disabled={busy} onClick={() => fileRef.current?.click()}>
                Import
              </button>
              <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={onFile} aria-label="Choose a town file to import" />
            </div>
          )}
          {status.unreadableKept && (
            <p className="saves-kept">
              An autosave that could not be loaded is kept aside.{' '}
              <button className="link-button" onClick={() => void exportUnreadable()}>
                Download it
              </button>
            </p>
          )}
        </section>

        {!onTitle && (
          <section className="saves-new">
            <h3>New town</h3>
            <p>Starts a fresh map. This deletes your autosave; Slots 1 to 3 are kept.</p>
            <div className="slot-actions">
              <button className="pill pill-danger" onClick={() => setUi({ savesOpen: false, newTownOpen: true })}>
                New town…
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
