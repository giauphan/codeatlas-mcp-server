import { test } from 'node:test';
import assert from 'node:assert';
import { checkAuth } from './authService.js';
import { authStorage } from '../context.js';

test('checkAuth requires authStorage when MULTI_TENANT is enabled', async () => {
  const originalMultiTenant = process.env.CODEATLAS_MULTI_TENANT;
  process.env.CODEATLAS_MULTI_TENANT = 'true';
  try {
    await assert.rejects(
      async () => await checkAuth(),
      { message: 'Unauthorized: Missing tenant authentication context.' }
    );
  } finally {
    process.env.CODEATLAS_MULTI_TENANT = originalMultiTenant;
  }
});

test('checkAuth returns fallback user when not in MULTI_TENANT mode (stdio)', async () => {
  const originalMultiTenant = process.env.CODEATLAS_MULTI_TENANT;
  delete process.env.CODEATLAS_MULTI_TENANT;
  try {
    const auth = await checkAuth();
    assert.deepStrictEqual(auth, {
      tier: 'enterprise',
      uid: 'local-user',
      keyId: 'local-key'
    });
  } finally {
    process.env.CODEATLAS_MULTI_TENANT = originalMultiTenant;
  }
});

test('checkAuth returns authStorage context if populated', async () => {
  const mockAuth = { tier: 'pro', uid: 'test-uid', keyId: 'test-key' };
  
  await authStorage.run(mockAuth, async () => {
    const auth = await checkAuth();
    assert.deepStrictEqual(auth, mockAuth);
  });
});
