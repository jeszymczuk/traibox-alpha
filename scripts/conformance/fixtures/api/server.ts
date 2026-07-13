const app = {} as any;
declare function requireRequestRole(request: unknown, roles: string[]): void;
declare function executeSyntheticAction(): void;

app.post('/v1/method-mismatch', async () => null);
app.post('/v1/role-mismatch', async (request: unknown) => {
  requireRequestRole(request, ['admin']);
});
app.post('/v1/protected', async (request: unknown) => {
  requireRequestRole(request, ['owner']);
  executeSyntheticAction();
});
