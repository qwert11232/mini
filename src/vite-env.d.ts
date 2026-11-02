/// <reference types="vite/client" />

/**
 * Типы окружения Vite. Раньше `vite/client` и `node` были прописаны в `types`
 * корневого tsconfig — из-за этого сборщик функций Vercel падал с
 * «Cannot find type definition file for 'node'» и функции уезжали сломанными.
 * Теперь типы подключаются здесь, через reference.
 */
