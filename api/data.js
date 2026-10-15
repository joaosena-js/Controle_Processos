const { neon } = require('@neondatabase/serverless');
module.exports = async (req, res) => {
  const pw = process.env.APP_PASSWORD;
  if (!pw) return res.status(500).json({ error: 'Defina a variável APP_PASSWORD na Vercel' });
  if (req.headers['x-pass'] !== pw) return res.status(401).json({ error: 'Senha inválida' });
  try {
    const sql = neon(process.env.DATABASE_URL);
    await sql`create table if not exists processos(id serial primary key, data jsonb not null)`;
    await sql`create table if not exists listas(k text primary key, v jsonb not null)`;
    if (req.method === 'GET') {
      const p = await sql`select id, data from processos order by id`;
      const l = await sql`select v from listas where k = 'main'`;
      return res.json({ processos: p.map(r => ({ ...r.data, id: r.id })), listas: l[0] ? l[0].v : null });
    }
    const b = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    if (b.op === 'save') {
      const { id, ...d } = b.item;
      if (id) { await sql`update processos set data = ${JSON.stringify(d)}::jsonb where id = ${id}`; return res.json({ id }); }
      const r = await sql`insert into processos(data) values (${JSON.stringify(d)}::jsonb) returning id`;
      return res.json({ id: r[0].id });
    }
    if (b.op === 'del') { await sql`delete from processos where id = ${b.id}`; return res.json({ ok: 1 }); }
    if (b.op === 'bulk') {
      const items = b.items.map(({ id, ...d }) => d);
      await sql`delete from processos`;
      await sql`insert into processos(data) select value from jsonb_array_elements(${JSON.stringify(items)}::jsonb)`;
      return res.json({ ok: 1 });
    }
    if (b.op === 'merge') {
      const dels = b.deltipos || [], ups = b.updates || [], news = b.news || [];
      if (dels.length) await sql`delete from processos where data->>'tipo' in (select jsonb_array_elements_text(${JSON.stringify(dels)}::jsonb))`;
      if (ups.length) await sql`update processos p set data = v.data from jsonb_to_recordset(${JSON.stringify(ups)}::jsonb) as v(id int, data jsonb) where p.id = v.id`;
      if (news.length) await sql`insert into processos(data) select value from jsonb_array_elements(${JSON.stringify(news)}::jsonb)`;
      return res.json({ ok: 1 });
    }
    if (b.op === 'listas') {
      await sql`insert into listas(k, v) values ('main', ${JSON.stringify(b.listas)}::jsonb) on conflict (k) do update set v = excluded.v`;
      return res.json({ ok: 1 });
    }
    res.status(400).json({ error: 'Operação inválida' });
  } catch (e) { res.status(500).json({ error: e.message }); }
};
