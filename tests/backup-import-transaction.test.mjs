import test from 'node:test';
import assert from 'node:assert/strict';
import { runBackupImportTransaction } from '../assets/backup-import-transaction.js';

function cloneMap(map) {
  return new Map([...map].map(([key, value]) => [key, structuredClone(value)]));
}

function createFixture() {
  const state = {
    packets: new Map([
      ['2026-11-18', { packet: 'existing-packet', dirty: true }],
      ['2026-11-17', { packet: 'older-packet', dirty: false }]
    ]),
    localRecords: new Map([
      ['mindful_pokes_data_2026-11-18', '{"completed":true}'],
      ['garden_state_v1', '{"plants":["seedling"]}'],
      ['user_confidence_score', '7']
    ]),
    voiceNotes: [
      { id: 'existing-voice', dateString: '2026-11-18', ciphertext: 'old-ciphertext' }
    ]
  };
  const snapshot = {
    packets: cloneMap(state.packets),
    localRecords: cloneMap(state.localRecords),
    voiceNotes: structuredClone(state.voiceNotes)
  };
  const rollback = [
    {
      label: 'daily-packet rollback',
      run: async () => { state.packets = cloneMap(snapshot.packets); }
    },
    {
      label: 'local-storage rollback',
      run: async () => { state.localRecords = cloneMap(snapshot.localRecords); }
    },
    {
      label: 'voice-note rollback',
      run: async () => { state.voiceNotes = structuredClone(snapshot.voiceNotes); }
    }
  ];
  return { state, snapshot, rollback };
}

test('backup import commits all stores on success and does not invoke rollback', async () => {
  const { state, rollback } = createFixture();
  const operations = [];

  const result = await runBackupImportTransaction({
    apply: async () => {
      operations.push('merge voice notes');
      state.voiceNotes.push({
        id: 'imported-voice', dateString: '2026-11-18', ciphertext: 'new-ciphertext'
      });
      operations.push('restore daily bundle');
      state.localRecords.set('mindful_pokes_data_2026-11-18', '{"completed":false}');
      operations.push('persist encrypted packet');
      state.packets.set('2026-11-18', { packet: 'imported-packet', dirty: true });
      return 'committed';
    },
    rollback: rollback.map(step => ({
      label: step.label,
      run: async () => { operations.push('unexpected ' + step.label); await step.run(); }
    }))
  });

  assert.equal(result, 'committed');
  assert.deepEqual(operations, [
    'merge voice notes',
    'restore daily bundle',
    'persist encrypted packet'
  ]);
  assert.equal(state.packets.get('2026-11-18').packet, 'imported-packet');
  assert.equal(state.localRecords.get('mindful_pokes_data_2026-11-18'), '{"completed":false}');
  assert.equal(state.voiceNotes.length, 2);
});

test('partial writes at each import stage restore packet, local-storage, and voice-note snapshots', async () => {
  for (const failureStage of ['voice-note merge', 'daily-bundle restore', 'packet persistence']) {
    const { state, snapshot, rollback } = createFixture();
    const failure = new Error(failureStage + ' failed');

    await assert.rejects(
      runBackupImportTransaction({
        apply: async () => {
          state.voiceNotes.push({
            id: 'partially-imported-voice',
            dateString: '2026-11-18',
            ciphertext: 'partial-ciphertext'
          });
          if (failureStage === 'voice-note merge') throw failure;

          state.localRecords.set('mindful_pokes_data_2026-11-18', '{"completed":false}');
          state.localRecords.set('dmp_notes_cipher_v1_2026-11-18', 'new-encrypted-notes');
          if (failureStage === 'daily-bundle restore') throw failure;

          state.packets.set('2026-11-18', { packet: 'partially-persisted-packet', dirty: true });
          throw failure;
        },
        rollback
      }),
      error => error === failure
    );

    assert.deepEqual(state.packets, snapshot.packets, failureStage + ': packet state');
    assert.deepEqual(state.localRecords, snapshot.localRecords, failureStage + ': local records');
    assert.deepEqual(state.voiceNotes, snapshot.voiceNotes, failureStage + ': voice notes');
  }
});

test('rollback continues after an individual rollback failure and preserves every failure detail', async () => {
  const attempts = [];
  const primaryFailure = new Error('packet persistence failed');

  await assert.rejects(
    runBackupImportTransaction({
      apply: async () => { throw primaryFailure; },
      rollback: [
        {
          label: 'daily-packet rollback',
          run: async () => {
            attempts.push('daily packets');
            throw new Error('IndexedDB is unavailable');
          }
        },
        {
          label: 'local-storage rollback',
          run: async () => {
            attempts.push('local storage');
            throw new Error('storage quota was exceeded');
          }
        },
        {
          label: 'voice-note rollback',
          run: async () => { attempts.push('voice notes'); }
        }
      ]
    }),
    error => {
      assert.match(error.message, /packet persistence failed/);
      assert.match(error.message, /daily-packet rollback failed: IndexedDB is unavailable/);
      assert.match(error.message, /local-storage rollback failed: storage quota was exceeded/);
      assert.match(error.message, /Keep this device open and export any remaining local records/);
      return true;
    }
  );

  assert.deepEqual(attempts, ['daily packets', 'local storage', 'voice notes']);
});

test('invalid transaction configuration is rejected before the apply operation runs', async () => {
  let applied = false;
  await assert.rejects(
    runBackupImportTransaction({
      apply: async () => { applied = true; },
      rollback: [{ label: 'missing rollback callback' }]
    }),
    { name: 'TypeError' }
  );
  assert.equal(applied, false);
});
