app.get('/v1/events', (req) => verify((req.query as any)?.token));
app.get('/v1/files', (req) => verify((req.query as any)?.token));
