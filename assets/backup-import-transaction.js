export async function runBackupImportTransaction({ apply, rollback } = {}) {
  if (typeof apply !== 'function' || !Array.isArray(rollback)
      || rollback.some(step => !step || typeof step.label !== 'string'
        || !step.label.trim() || typeof step.run !== 'function')) {
    throw new TypeError('A backup import requires an apply operation and valid rollback steps.');
  }

  try {
    return await apply();
  } catch (error) {
    const rollbackErrors = [];
    for (const step of rollback) {
      try {
        await step.run();
      } catch (rollbackError) {
        rollbackErrors.push(
          step.label + ' failed: ' + (rollbackError?.message || String(rollbackError))
        );
      }
    }

    if (rollbackErrors.length) {
      const primaryMessage = error?.message || 'The backup import failed.';
      throw new Error(primaryMessage
        + ' Automatic rollback reported: ' + rollbackErrors.join('; ')
        + '. Keep this device open and export any remaining local records before retrying.');
    }

    throw error;
  }
}
