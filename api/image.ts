import { getDb } from './_lib/db.js'
import { getFileUrl } from './bot/_lib/telegram.js'

/**
 * GET /api/image?product=<id> — картинка товара.
 *
 * Фото, загруженные через бота, хранятся в Telegram как `tg:<file_id>`. Прямую
 * ссылку Telegram отдавать нельзя: в ней лежит токен бота. Поэтому скачиваем
 * файл на сервере и отдаём браузеру уже байты, с кэшем на сутки.
 */
async function handler(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get('product')
  if (!id) return new Response('Не передан товар', { status: 400 })

  try {
    const sql = getDb()
    const rows = (await sql`
      select image from products where id = ${id} and is_active
    `) as unknown as { image: string | null }[]
    const image = rows[0]?.image
    if (!image) return new Response('Нет фото', { status: 404 })

    // Внешние картинки (например /img/shop-racket.jpg) проксировать незачем.
    if (!image.startsWith('tg:')) {
      return Response.redirect(new URL(image, request.url).toString(), 302)
    }

    const url = await getFileUrl(image.slice(3))
    if (!url) return new Response('Фото недоступно', { status: 404 })

    const upstream = await fetch(url)
    if (!upstream.ok) return new Response('Фото недоступно', { status: 502 })

    return new Response(upstream.body, {
      headers: {
        'content-type': upstream.headers.get('content-type') ?? 'image/jpeg',
        'cache-control': 'public, max-age=86400, s-maxage=604800, immutable',
      },
    })
  } catch (error) {
    console.error('[api/image]', error instanceof Error ? error.message : error)
    return new Response('Фото недоступно', { status: 502 })
  }
}

/**
 * Vercel (Node runtime) понимает Web-сигнатуру только через объект с методом `fetch`.
 * «Голый» default-экспорт вызывается как handler(req, res) — Response терялся (500/504).
 */
export default { fetch: handler }
