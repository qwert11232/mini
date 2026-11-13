// Опциональный интеграционный тест: ТОЛЬКО одноразовая локальная база.
// Данные изолируются в случайной схеме и удаляются после теста; рабочую Neon не использовать.
// Пример: TEST_DATABASE_URL=postgres://...@127.0.0.1:5432/mini_race_test npm run test:postgres
import { registerHooks } from 'node:module'
import { readFile } from 'node:fs/promises'
import { createHmac, randomBytes } from 'node:crypto'
import assert from 'node:assert/strict'
import pg from 'pg'

const rawUrl = process.env.TEST_DATABASE_URL
if (!rawUrl) throw new Error('Укажите TEST_DATABASE_URL для одноразовой локальной базы mini_race_test')
const testUrl = new URL(rawUrl)
if (!['postgres:', 'postgresql:'].includes(testUrl.protocol) || testUrl.hostname !== '127.0.0.1' ||
    testUrl.pathname !== '/mini_race_test' || testUrl.search || testUrl.hash) {
  throw new Error('Тест разрешён только для 127.0.0.1 и отдельной базы mini_race_test без параметров URL')
}

const { Pool } = pg
const schemaName = `mini_race_${randomBytes(8).toString('hex')}`
const control = new Pool({ connectionString: rawUrl, max: 1 })
let pool
let schemaCreated = false
const oldInfo = console.info
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
try {
  await control.query(`create schema "${schemaName}"`)
  schemaCreated = true
  pool = new Pool({ connectionString: rawUrl, max: 12, options: `-c search_path=${schemaName}` })
  assert.equal((await pool.query('select current_schema() as name')).rows[0].name, schemaName)
  const schema = (await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8'))
    .replace('create extension if not exists "pgcrypto";', '') // gen_random_uuid() встроен в PostgreSQL 13+
  await pool.query(schema)
  const query = async (strings, ...values) => {
    const text = strings.reduce((s, p, i) => s + p + (i < values.length ? `$${i + 1}` : ''), '')
    return (await pool.query(text, values)).rows
  }
  query.query = async (text, values) => (await pool.query(text, values)).rows
  globalThis.__raceTestDb = query
  // Neon-клиент ниже подменён локальным пулом: сеть к Neon не используется.
  process.env.DATABASE_URL = rawUrl
  process.env.TELEGRAM_BOT_TOKEN = 'race-test-token'
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === '@neondatabase/serverless') return { url: 'test:race-neon', shortCircuit: true }
      if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL?.includes('/api/')) {
        return nextResolve(specifier.slice(0, -3) + '.ts', context)
      }
      return nextResolve(specifier, context)
    },
    load(url, context, nextLoad) {
      if (url === 'test:race-neon') return { format: 'module', shortCircuit: true, source: 'export function neon() { return globalThis.__raceTestDb }' }
      return nextLoad(url, context)
    },
  })
  const { restoreBooking, closeSlot, openSlot } = await import(new URL('../api/bot/_lib/admin.ts', import.meta.url))
  const { cancelBooking: cancelAdmin } = await import(new URL('../api/bot/_lib/bookings.ts', import.meta.url))
  const { updateSession, deleteSession, deleteSlot } = await import(new URL('../api/bot/_lib/catalog-admin.ts', import.meta.url))
  const { createBooking } = await import(new URL('../api/bookings.ts', import.meta.url))
  const secret = createHmac('sha256', 'WebAppData').update(process.env.TELEGRAM_BOT_TOKEN).digest()
  function request(kind, sourceId, id) {
    const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: 'Test' }) })
    const data = [...params.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${k}=${v}`).join('\n')
    params.set('hash', createHmac('sha256', secret).update(data).digest('hex'))
    return new Request('https://example.test/api/bookings', { method: 'POST', headers: { authorization: `tma ${params}` }, body: JSON.stringify({kind, sourceId}) })
  }
  await pool.query(`
    insert into courts (id,name,surface) values ('c','Court','Hard');
    insert into coaches (id,name,role,initials) values ('coach','Coach','Coach','C');
    insert into users (telegram_id,first_name) values (111111111,'A'), (222222222,'B');
    insert into free_slots(id,court_id,day_offset,start_time,duration_min,price,starts_at)
      values ('rslot','c',1,'18:00',60,1000,((now() at time zone 'Europe/Moscow')::date + 1 + time '18:00') at time zone 'Europe/Moscow');
    insert into training_sessions(id,title,group_kind,level,coach_id,court_id,day_offset,start_time,duration_min,price,seats_total,starts_at)
      values ('rtraining','Training','Group','Beginner','coach','c',1,'18:00',60,1000,2,((now() at time zone 'Europe/Moscow')::date + 1 + time '18:00') at time zone 'Europe/Moscow');
  `)
  async function lockedRace(table, id, operations) {
    const lock = await pool.connect()
    try {
      await lock.query('begin')
      await lock.query(`select id from ${table} where id=$1 for update`, [id])
      const pending = operations.map((run) => run())
      await wait(25)
      await lock.query('commit')
      return await Promise.allSettled(pending)
    } finally {
      await lock.query('rollback').catch(() => {})
      lock.release()
    }
  }
  console.info = () => {}
  for (let i=0;i<35;i++) {
    await pool.query("delete from bookings where source_id='rslot'")
    await pool.query("update free_slots set is_active=true where id='rslot'")
    const ids = (await pool.query(`insert into bookings(user_id,kind,source_id,title,day_offset,start_time,duration_min,price,status,starts_at)
      select u.id,'free',f.id,'test',1,f.start_time,f.duration_min,f.price,'cancelled',f.starts_at from users u cross join free_slots f
      where u.telegram_id in (111111111,222222222) and f.id='rslot' returning bookings.id`)).rows.map((r) => r.id)
    const results = await lockedRace('free_slots','rslot', ids.map((id) => () => restoreBooking(id, 793536041)))
    assert.ok(results.every((r) => r.status === 'fulfilled'), JSON.stringify(results))
    assert.equal(results.filter((r) => r.value.ok).length,1)
    const row = (await pool.query("select (select count(*)::int from bookings where source_id='rslot' and status='active') n, is_active from free_slots where id='rslot'")).rows[0]
    assert.deepEqual(row, {n:1,is_active:false})
  }
  console.log('✓ PostgreSQL: 35 параллельных восстановлений одного окна')

  for (let i=0;i<35;i++) {
    await pool.query("delete from bookings where source_id='rslot'")
    await pool.query("update free_slots set is_active=true where id='rslot'")
    const id = (await pool.query(`insert into bookings(user_id,kind,source_id,title,day_offset,start_time,duration_min,price,status,starts_at)
      select u.id,'free',f.id,'test',1,f.start_time,f.duration_min,f.price,'cancelled',f.starts_at from users u cross join free_slots f
      where u.telegram_id=111111111 and f.id='rslot' returning bookings.id`)).rows[0].id
    const results = await lockedRace('free_slots','rslot', [() => restoreBooking(id, 793536041), () => createBooking(request('free','rslot',800000000+i))])
    assert.ok(results.every((r) => r.status === 'fulfilled'), JSON.stringify(results))
    const success = Number(results[0].value.ok) + Number(results[1].value.status === 201)
    assert.equal(success,1)
    const row = (await pool.query("select (select count(*)::int from bookings where source_id='rslot' and status='active') n, is_active from free_slots where id='rslot'")).rows[0]
    assert.deepEqual(row, {n:1,is_active:false})
  }
  console.log('✓ PostgreSQL: 35 гонок восстановления и новой аренды')

  for (let i=0;i<30;i++) {
    await pool.query("delete from bookings where source_id='rtraining'")
    await pool.query("update training_sessions set seats_taken=0,is_active=true where id='rtraining'")
    const id = (await pool.query(`insert into bookings(user_id,kind,source_id,title,day_offset,start_time,duration_min,price,status,starts_at)
      select u.id,'training',s.id,'test',1,s.start_time,s.duration_min,s.price,'cancelled',s.starts_at from users u cross join training_sessions s
      where u.telegram_id=111111111 and s.id='rtraining' returning bookings.id`)).rows[0].id
    const results = await lockedRace('training_sessions','rtraining', [() => restoreBooking(id,793536041), () => createBooking(request('training','rtraining',111111111))])
    assert.ok(results.every((r) => r.status === 'fulfilled'), JSON.stringify(results))
    const success = Number(results[0].value.ok) + Number(results[1].value.status === 201)
    assert.equal(success,1)
    const row = (await pool.query("select (select count(*)::int from bookings where source_id='rtraining' and status='active') n, seats_taken from training_sessions where id='rtraining'")).rows[0]
    assert.deepEqual(row, {n:1,seats_taken:1})
  }
  console.log('✓ PostgreSQL: 30 гонок восстановления и повторной записи игрока')

  for (let i=0;i<30;i++) {
    await pool.query("delete from bookings where source_id='rtraining'")
    await pool.query("update training_sessions set seats_taken=0, seats_total=2, is_active=true, start_time='18:00', starts_at=((now() at time zone 'Europe/Moscow')::date + 1 + time '18:00') at time zone 'Europe/Moscow' where id='rtraining'")
    const results = await lockedRace('training_sessions','rtraining', [() => updateSession('rtraining',{start:'20:00'},793536041), () => createBooking(request('training','rtraining',820000000+i))])
    assert.ok(results.every((r) => r.status === 'fulfilled'), JSON.stringify(results))
    assert.equal(results[1].value.status, 201)
    const row = (await pool.query("select s.starts_at=snapshot.starts_at as matches, s.seats_taken from training_sessions s join bookings snapshot on snapshot.source_id=s.id and snapshot.status='active' where s.id='rtraining'")).rows[0]
    assert.deepEqual(row, {matches:true,seats_taken:1})
  }
  console.log('✓ PostgreSQL: 30 гонок изменения времени и записи')

  for (let i=0;i<25;i++) {
    await pool.query("delete from bookings where source_id='rtraining'")
    await pool.query("update training_sessions set seats_taken=0, seats_total=2, is_active=true where id='rtraining'")
    const results = await lockedRace('training_sessions','rtraining', [() => deleteSession('rtraining',793536041), () => createBooking(request('training','rtraining',830000000+i))])
    assert.ok(results.every((r) => r.status === 'fulfilled'), JSON.stringify(results))
    const orphan = (await pool.query("select count(*)::int n from bookings b left join training_sessions s on s.id=b.source_id where b.source_id='rtraining' and b.status='active' and s.id is null")).rows[0].n
    assert.equal(orphan,0)
    if (!(await pool.query("select id from training_sessions where id='rtraining'")).rowCount) {
      await pool.query("insert into training_sessions(id,title,group_kind,level,coach_id,court_id,day_offset,start_time,duration_min,price,seats_total,starts_at) values ('rtraining','Training','Group','Beginner','coach','c',1,'18:00',60,1000,2,((now() at time zone 'Europe/Moscow')::date + 1 + time '18:00') at time zone 'Europe/Moscow')")
    }
  }
  console.log('✓ PostgreSQL: 25 гонок удаления занятия и записи')

  for (let i=0;i<25;i++) {
    await pool.query("delete from bookings where source_id='rslot'")
    await pool.query("insert into free_slots(id,court_id,day_offset,start_time,duration_min,price,starts_at) values ('rslot','c',1,'18:00',60,1000,((now() at time zone 'Europe/Moscow')::date + 1 + time '18:00') at time zone 'Europe/Moscow') on conflict (id) do update set is_active=true")
    const results = await lockedRace('free_slots','rslot', [() => deleteSlot('rslot',793536041), () => createBooking(request('free','rslot',840000000+i))])
    assert.ok(results.every((r) => r.status === 'fulfilled'), JSON.stringify(results))
    const orphan = (await pool.query("select count(*)::int n from bookings b left join free_slots f on f.id=b.source_id where b.source_id='rslot' and b.status='active' and f.id is null")).rows[0].n
    assert.equal(orphan,0)
  }
  console.log('✓ PostgreSQL: 25 гонок удаления окна и записи')

  // Одновременное открытие телефонной брони и запись игрока не создаёт двойную бронь.
  for (let i = 0; i < 30; i++) {
    await pool.query("delete from bookings where source_id='rslot'")
    await pool.query("insert into free_slots(id,court_id,day_offset,start_time,duration_min,price,starts_at) values ('rslot','c',1,'18:00',60,1000,((now() at time zone 'Europe/Moscow')::date + 1 + time '18:00') at time zone 'Europe/Moscow') on conflict (id) do update set is_active=true")
    assert.equal((await closeSlot('rslot', 793536041)).ok, true)
    const results = await Promise.allSettled([
      openSlot('rslot', 793536041),
      createBooking(request('free', 'rslot', 850000000 + i)),
    ])
    assert.ok(results.every((r) => r.status === 'fulfilled'), JSON.stringify(results))
    const state = (await pool.query("select (select count(*)::int from bookings where source_id='rslot' and status='active') n, is_active from free_slots where id='rslot'")).rows[0]
    assert.ok(state.n <= 1)
    assert.equal(state.is_active, state.n === 0)
  }
  console.log('✓ PostgreSQL: 30 гонок открытия телефонной брони и записи игрока')

  // Принудительно совмещаем открытие вручную занятого окна с отменой его записи.
  await pool.query("delete from bookings where source_id='rslot'")
  await pool.query("insert into free_slots(id,court_id,day_offset,start_time,duration_min,price,starts_at) values ('rslot','c',1,'18:00',60,1000,((now() at time zone 'Europe/Moscow')::date + 1 + time '18:00') at time zone 'Europe/Moscow') on conflict (id) do update set is_active=true")
  await closeSlot('rslot',793536041)
  const manualId = (await pool.query("select id from bookings where source_id='rslot' and status='active'")).rows[0].id
  await pool.query(`create function test_delay_lock() returns trigger language plpgsql as $$ begin perform pg_sleep(0.1); return new; end $$;
    create trigger delay_slot before update on free_slots for each row when (old.id='rslot') execute function test_delay_lock();
    create trigger delay_book before update on bookings for each row when (old.source_id='rslot') execute function test_delay_lock();`)
  const opposed = await Promise.allSettled([openSlot('rslot',793536041), cancelAdmin(manualId,793536041)])
  const errors = opposed.filter((r) => r.status === 'rejected').map((r) => ({code:r.reason.code, message:r.reason.message}))
  const manualState = (await pool.query("select (select count(*)::int from bookings where source_id='rslot' and status='active') n, is_active from free_slots where id='rslot'")).rows[0]
  assert.ok(manualState.n <= 1)
  assert.deepEqual(errors, [], 'открытие окна и отмена не должны вызывать deadlock')
  assert.deepEqual(manualState, { n: 0, is_active: true })
  console.log('✓ PostgreSQL: открытие окна одновременно с отменой без deadlock')
  await pool.query('drop trigger delay_slot on free_slots; drop trigger delay_book on bookings; drop function test_delay_lock()')
} finally {
  console.info = oldInfo
  if (pool) await pool.end()
  try {
    if (schemaCreated) await control.query(`drop schema "${schemaName}" cascade`)
  } finally {
    await control.end()
  }
}
