# 🔍 SECURITY, BUG & ERROR AUDIT PROMPT
# Archivo: AUDIT_PROMPT.md
# Uso: Pegar en GitHub Copilot Chat con @workspace antes de cada release

---

## ROL
Actuá como un ingeniero senior de seguridad y QA con experiencia en
aplicaciones fullstack (Node.js + React + PostgreSQL). Tu tarea es hacer
una auditoría COMPLETA del proyecto. No omitas nada. Si algo "parece bien",
igual verificalo explícitamente.

---

## 🔴 BLOQUE 1 — SEGURIDAD BACKEND

### Autenticación y Autorización
- [ ] ¿Todos los endpoints tienen middleware de autenticación JWT?
      Listá cualquier ruta que no lo tenga (excepto /auth/login)
- [ ] ¿Los tokens JWT se almacenan en httpOnly cookies?
      Si se usan localStorage o sessionStorage → BUG CRÍTICO
- [ ] ¿El accessToken expira en 15 minutos o menos?
- [ ] ¿El refreshToken rota correctamente en cada uso?
- [ ] ¿Existe protección contra JWT algorithm confusion attack?
      Verificar que el algoritmo esté hardcodeado (HS256 o RS256), nunca "none"
- [ ] ¿Los endpoints verifican el ROL además del token?
      Un GESTOR no puede acceder a rutas de SUPERVISOR/ADMIN
- [ ] ¿Existe protección contra IDOR (Insecure Direct Object Reference)?
      Ej: GET /evaluaciones/123 → verificar que el usuario tenga acceso a ese ID

### Datos de Entrada
- [ ] ¿Todos los endpoints tienen validación con Zod o similar?
- [ ] ¿Se validan tipos, longitudes mínimas/máximas y formatos en TODOS los campos?
- [ ] ¿Los parámetros de URL (:id) se validan como UUID válido antes de ir a la DB?
- [ ] ¿Existe protección contra inyección NoSQL/SQL aunque se use Prisma?
      Prisma protege por defecto, pero verificar queryRaw y executeRaw
- [ ] ¿Los mensajes de error NO exponen detalles internos (stack trace, queries, paths)?

### Archivos Subidos (MP3)
- [ ] ¿Se valida el MIME type REAL del archivo (no solo la extensión)?
      Usar librería 'file-type', no confiar en mimetype del request
- [ ] ¿Existe límite de tamaño estricto (25MB máximo)?
- [ ] ¿El nombre del archivo se regenera con UUID antes de guardar?
      Nunca usar el filename original del cliente
- [ ] ¿Los archivos se guardan FUERA del directorio web-accessible?
- [ ] ¿Existe protección contra path traversal en el filename?
      Ej: filename: "../../etc/passwd"

### Headers y Configuración
- [ ] ¿Helmet.js está configurado con TODOS sus middlewares?
      Verificar: CSP, X-Frame-Options, HSTS, X-Content-Type-Options, Referrer-Policy
- [ ] ¿CORS tiene whitelist explícita? Nunca origin: '*' en producción
- [ ] ¿Existe rate limiting en todos los endpoints?
      - /auth/login → máx 10 req / 15min / IP
      - /upload-audio → máx 20 req / hora / usuario
      - Resto → máx 100 req / min / usuario
- [ ] ¿Las variables de entorno se validan al startup?
      Si falta OPENAI_API_KEY, JWT_SECRET o DATABASE_URL → el servidor NO arranca

### Secretos y Logs
- [ ] ¿Ningún archivo fuente tiene API keys, passwords o secrets hardcodeados?
      Buscar con regex: /sk-|password\s*=|secret\s*=/gi en todo el código
- [ ] ¿Los logs NUNCA registran: passwords, tokens JWT, API keys, datos de tarjetas?
- [ ] ¿El .env está en .gitignore? ¿Existe .env.example sin valores reales?
- [ ] ¿La OPENAI_API_KEY nunca llega al frontend ni aparece en responses?

### Dependencias
- [ ] Ejecutar: npm audit --audit-level=high en /backend
- [ ] Listar todas las vulnerabilidades HIGH y CRITICAL encontradas
- [ ] ¿Existe script de auditoría en package.json?

---

## 🟠 BLOQUE 2 — SEGURIDAD FRONTEND

- [ ] ¿El frontend NUNCA llama directamente a la API de OpenAI?
      Buscar: 'openai.com' o 'sk-' en todo el código del frontend
- [ ] ¿Ningún secreto está en variables VITE_ que queden expuestas al cliente?
      Solo VITE_API_URL es aceptable. Cualquier otra clave → BUG CRÍTICO
- [ ] ¿El contenido generado por IA (transcripción, análisis) se sanitiza antes de renderizar?
      Usar DOMPurify si se usa dangerouslySetInnerHTML
- [ ] ¿Los errores del backend muestran mensajes genéricos al usuario?
      Nunca mostrar stack traces, paths o queries en la UI
- [ ] ¿Las rutas privadas redirigen a /login si no hay sesión activa?
- [ ] ¿El token no se expone en la URL ni en query params?
- [ ] Ejecutar: npm audit --audit-level=high en /frontend

---

## 🟡 BLOQUE 3 — BASE DE DATOS

### Schema y Estructura
- [ ] ¿Todos los modelos tienen los índices necesarios?
      Verificar índices en: gestorId, auditorId, status, capture_date, score_total
- [ ] ¿Las FK tienen onDelete explícito (RESTRICT o CASCADE según corresponda)?
- [ ] ¿Se usa @db.Decimal(5,2) para scores en lugar de Float?
- [ ] ¿Los campos de texto corto tienen @db.VarChar(n) con límite explícito?
- [ ] ¿Existe soft delete (deletedAt) en Evaluation y Gestor?
- [ ] ¿Todos los queries filtran where: { deletedAt: null }?

### Operaciones
- [ ] ¿Las operaciones que escriben en múltiples tablas usan transacciones de Prisma?
      Ej: guardar Evaluation + DebtorAnalysis en el mismo prisma.$transaction()
- [ ] ¿Se usa cursor-based pagination en lugar de OFFSET para listados grandes?
- [ ] ¿El usuario de PostgreSQL tiene solo los permisos mínimos necesarios?
      Solo SELECT/INSERT/UPDATE/DELETE — nunca superuser en producción
- [ ] ¿La conexión a la DB solo es accesible desde el backend (no expuesta al exterior)?
- [ ] ¿Existe configuración de backups automáticos en docker-compose?

### Migraciones
- [ ] ¿Se usa prisma migrate deploy en producción (nunca prisma db push)?
- [ ] ¿Existe seed con datos iniciales (usuario admin, roles)?
- [ ] ¿Las migraciones están documentadas en el README?

---

## 🔵 BLOQUE 4 — BUGS FUNCIONALES

### Flujo de Evaluación
- [ ] ¿Qué pasa si Whisper falla? ¿Se maneja el error y se notifica al usuario?
- [ ] ¿Qué pasa si GPT-4o devuelve un JSON malformado?
      Debe haber try/catch + fallback, no puede romper la evaluación entera
- [ ] ¿Qué pasa si el usuario cierra el browser durante el procesamiento del audio?
      El job en cola debe continuar y el estado debe recuperarse al volver
- [ ] ¿El call_id es único? ¿Se valida antes de insertar para evitar duplicados?
- [ ] ¿El cálculo de score_total usa la fórmula correcta?
      CORE (50%) + BASICS (35%) + resto (15%) — verificar con casos de prueba

### Roles y Permisos
- [ ] ¿Un GESTOR puede ver evaluaciones de otro GESTOR? → Debe ser imposible
- [ ] ¿Un AUDITOR puede editar evaluaciones que no creó? → Debe ser imposible
- [ ] ¿El dashboard filtra datos según el rol del usuario logueado?
- [ ] ¿El dropdown de gestores solo muestra usuarios con rol GESTOR?

### Upload de Archivos
- [ ] ¿La barra de progreso muestra el avance real (axios onUploadProgress)?
- [ ] ¿Se puede subir solo un archivo a la vez?
- [ ] ¿El drag & drop rechaza archivos que no son .mp3 con mensaje claro?
- [ ] ¿Los archivos MP3 de más de 25MB son rechazados en cliente Y en servidor?

### Exportación PDF
- [ ] ¿El PDF generado coincide con el formato oficial de la empresa?
- [ ] ¿El PDF incluye todos los campos: gestor, auditor, scores, flags, observaciones?
- [ ] ¿Funciona correctamente cuando hay campos en N/A?

---

## 🟣 BLOQUE 5 — ERRORES Y MANEJO DE EXCEPCIONES

- [ ] ¿Existe un error handler global en Express que capture errores no manejados?
- [ ] ¿Todos los controllers tienen try/catch?
- [ ] ¿Los servicios de OpenAI tienen retry logic con backoff exponencial?
      Whisper y GPT pueden fallar por rate limit o timeout
- [ ] ¿Los errores de red del frontend muestran mensajes útiles al usuario?
      Ej: "El servidor no responde, intente nuevamente"
- [ ] ¿Existe manejo de timeout para requests largos (Whisper puede tardar 60s+)?
- [ ] ¿Los workers de BullMQ tienen manejo de failed jobs y reintentos?
- [ ] ¿El frontend tiene estados de error en todos los componentes que hacen fetch?
      Loading / Success / Error — los tres estados deben estar manejados

---

## 🟢 BLOQUE 6 — ESCALABILIDAD Y PERFORMANCE

- [ ] ¿El procesamiento de audio es asíncrono (BullMQ + Redis)?
      Si Whisper se llama en el request/response cycle → problema de timeout
- [ ] ¿El caché de Redis tiene TTL definido en todas las claves?
- [ ] ¿Las queries a la DB están optimizadas? Buscar N+1 queries en los listados
- [ ] ¿El StorageProvider está detrás de una interfaz para poder migrar a Azure Blob?
- [ ] ¿El AuthService está detrás de una interfaz para poder migrar a Azure AD?
- [ ] ¿El docker-compose tiene healthchecks en postgres y redis?
- [ ] ¿Los contenedores tienen restart: unless-stopped?

---

## 📋 FORMATO DE RESPUESTA ESPERADO

Para cada ítem encontrado reportá exactamente así:

### 🔴 CRÍTICO — [Nombre del problema]
- Archivo: src/routes/auth.routes.ts línea 42
- Problema: El endpoint /auth/me no verifica el token antes de responder
- Impacto: Cualquier usuario puede acceder a datos de otros usuarios
- Fix: Agregar middleware verifyToken antes del handler

### 🟠 ALTO — [Nombre del problema]
- Archivo: frontend/src/components/AudioUploader.tsx
- Problema: El MIME type se valida solo por extensión
- Impacto: Se puede subir un archivo malicioso con extensión .mp3
- Fix: Validar con file-type en el backend antes de procesar

### 🟡 MEDIO — [Nombre del problema]
### 🔵 BAJO — [Nombre del problema]
### ✅ OK — [Sección revisada sin problemas]

---

## ✅ ENTREGABLE FINAL

Al terminar la auditoría generá:
1. Lista priorizada de todos los problemas encontrados (crítico → bajo)
2. Estimación de tiempo de fix para cada uno
3. Los fixes de todos los ítems CRÍTICOS y ALTOS implementados directamente
4. Un resumen ejecutivo de 5 líneas con el estado general de seguridad del proyecto