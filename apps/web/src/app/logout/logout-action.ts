export async function submitExplicitLogout(input: {
  csrfToken: string;
  transport: typeof fetch;
  clearClientState: () => void;
  navigate: () => void;
}): Promise<void> {
  const response = await input.transport('/api/auth/logout', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'X-CSRF-Token': input.csrfToken }
  });
  if (!response.ok) throw new Error('Logout could not be completed securely');
  input.clearClientState();
  input.navigate();
}
