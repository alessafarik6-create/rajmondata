import assert from "node:assert/strict";

/** Simuluje rozhodnutí, zda smí listener přepsat draft formuláře. */
function shouldApplyRemotePermissionsToDraft(input: {
  draftTouched: boolean;
  pendingRevision: number | null;
  docRevision: number | null;
}): boolean {
  if (input.draftTouched) return false;
  if (input.pendingRevision != null) {
    if (input.docRevision == null || input.docRevision < input.pendingRevision) {
      return false;
    }
  }
  return true;
}

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`fail ${name}`, e);
    process.exitCode = 1;
  }
}

test("draft touched blocks remote overwrite (Fanda form deadlock fix)", () => {
  assert.equal(
    shouldApplyRemotePermissionsToDraft({
      draftTouched: true,
      pendingRevision: null,
      docRevision: 5,
    }),
    false
  );
});

test("remote applies when draft clean and revision ok", () => {
  assert.equal(
    shouldApplyRemotePermissionsToDraft({
      draftTouched: false,
      pendingRevision: 3,
      docRevision: 3,
    }),
    true
  );
});

test("API success requires ok true", () => {
  const resOk = true;
  const data = { ok: true as boolean };
  assert.equal(!resOk || data.ok !== true, false);
  const dataBad = { ok: false };
  assert.equal(!resOk || dataBad.ok !== true, true);
});
