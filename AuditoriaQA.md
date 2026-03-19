# 🏆 PROMPT DE AUDITORÍA DE CALIDAD DE PRODUCTO
# Archivo: QUALITY_AUDIT_PROMPT.md
# Uso: Copilot Chat → @workspace + este prompt antes de cada release

---

## ROL
Actuá como un Engineering Manager senior con experiencia en productos
SaaS productivos. Tu tarea es auditar el proyecto completo y asegurarte
de que está listo para producción real. Revisá cada bloque en orden y
reportá cada hallazgo con severidad y fix concreto.

---

## 🏗️ BLOQUE 1 — ARQUITECTURA Y ESTRUCTURA DEL PROYECTO

- [ ] ¿La separación frontend/backend es limpia? ¿No hay lógica de negocio en el frontend?
- [ ] ¿Los servicios de OpenAI (Whisper, GPT) están encapsulados en su propio módulo?
      No deben estar inline dentro de un controller o route
- [ ] ¿Existe una capa de servicios separada de la capa de rutas/controllers?
      routes → controllers → services → DB (nunca saltear capas)
- [ ] ¿El AuthService y StorageProvider están detrás de interfaces/abstracciones?
      Deben poder reemplazarse (Azure AD, Azure Blob) sin tocar el resto del código
- [ ] ¿No hay lógica duplicada entre archivos? Buscar copy-paste de funciones similares
- [ ] ¿Los tipos TypeScript están definidos en un lugar central (/types o /interfaces)?
      No debe haber tipos repetidos o inconsistentes entre front y back
- [ ] ¿Existe un archivo de constantes para magic numbers y strings?
      Ej: MAX_FILE_SIZE, SCORE_WEIGHTS, API_TIMEOUTS — nunca hardcodeados inline

---

## 🧹 BLOQUE 2 — CALIDAD DE CÓDIGO

### Legibilidad
- [ ] ¿Las funciones tienen nombres descriptivos que explican QUÉ hacen?
- [ ] ¿Ninguna función tiene más de 40 líneas? Si las tiene, debe refactorizarse
- [ ] ¿Los archivos tienen más de 300 líneas? Si los tienen, deben dividirse
- [ ] ¿Existen comentarios explicando el PORQUÉ (no el qué) en lógica compleja?
- [ ] ¿Las variables tienen nombres claros? Buscar: x, data, res, obj, temp, aux

### Consistencia
- [ ] ¿Se usa el mismo estilo en todo el proyecto (ESLint + Prettier configurados)?
- [ ] ¿Existe .eslintrc y .prettierrc en la raíz de front y back?
- [ ] ¿Todos los archivos siguen la misma convención de nombres?
      Backend: camelCase para archivos → auth.service.ts, user.controller.ts
      Frontend: PascalCase para componentes → AudioUploader.tsx, ScoringTable.tsx
- [ ] ¿Las importaciones están ordenadas? (librerías externas → internas → locales)
- [ ] ¿No hay console.log() olvidados en el código? Reemplazar por logger (winston/pino)
- [ ] ¿No hay código comentado que quedó olvidado? Eliminarlo o documentar por qué está

### TypeScript
- [ ] ¿Está configurado en modo strict en tsconfig.json?
- [ ] ¿No hay uso de 'any' explícito en ningún archivo?
      Buscar: ': any' y 'as any' en todo el proyecto
- [ ] ¿Las responses de la API tienen tipos definidos y compartidos entre front y back?
      Usar un paquete /shared o tipos duplicados explícitamente sincronizados
- [ ] ¿Los enums de la DB (ScoreValue, Role, ContactType) están reutilizados en el front?

---

## 🧪 BLOQUE 3 — TESTING

### Backend
- [ ] ¿Existen tests unitarios para los servicios críticos?
      Obligatorio: scoring.service, debtor-analysis.service, whisper.service
- [ ] ¿El cálculo de puntaje final tiene tests con casos de prueba reales?
      Ej: todos CUMPLE → 100%, un NO CUMPLE en CORE → impacto correcto
- [ ] ¿Existen tests de integración para los endpoints principales?
      POST /upload-audio, POST /score, GET /evaluaciones
- [ ] ¿Los tests mockean la API de OpenAI para no gastar créditos en cada test?
- [ ] ¿Está configurado un framework de testing? (Jest o Vitest)

### Frontend
- [ ] ¿Los componentes críticos tienen tests?
      Obligatorio: ScoringTable, AudioUploader, DebtorAnalysisCard
- [ ] ¿Existen tests para los hooks personalizados (useEvaluation, useAuth)?
- [ ] ¿Se testean los casos de error además del happy path?
      Ej: ¿Qué renderiza AudioUploader cuando el upload falla?

### Coverage
- [ ] ¿El coverage de tests supera el 60% en servicios del backend?
- [ ] ¿Está configurado el reporte de coverage? (jest --coverage)

---

## 🎨 BLOQUE 4 — UX/UI Y EXPERIENCIA DE USUARIO

### Estados de la UI
- [ ] ¿Cada operación asíncrona tiene sus 3 estados manejados?
      Loading → Success → Error (los tres, sin excepción)
- [ ] ¿Los estados de loading tienen skeletons o spinners apropiados?
      No debe haber pantallas en blanco mientras carga
- [ ] ¿Los errores muestran mensajes útiles y accionables para el usuario?
      "Error al procesar el audio. Verificá que el archivo sea un MP3 válido."
      No: "Error 500" o "Something went wrong"
- [ ] ¿Los formularios muestran validación inline (no solo al submit)?
- [ ] ¿Existe feedback visual inmediato al hacer click en botones?
      Los botones deben deshabilitarse mientras procesa para evitar doble submit

### Flujo de Evaluación
- [ ] ¿El usuario sabe en todo momento en qué paso del proceso está?
      Stepper o indicador de progreso: Subir → Transcribir → Puntuar → Revisar
- [ ] ¿El progreso de upload del MP3 muestra porcentaje real?
- [ ] ¿El tiempo estimado de procesamiento de Whisper se comunica al usuario?
- [ ] ¿Si el usuario recarga la página durante el procesamiento, puede recuperar el estado?
- [ ] ¿Los campos editables del scoring tienen indicación visual clara de que son editables?

### Accesibilidad
- [ ] ¿Todos los inputs tienen labels asociados correctamente?
- [ ] ¿El drag & drop del MP3 también funciona con teclado?
- [ ] ¿Los colores de CUMPLE/NO CUMPLE tienen contraste suficiente (WCAG AA)?
- [ ] ¿Las tablas de scoring tienen headers semánticos (<th>)?

### Responsive
- [ ] ¿La app funciona correctamente en tablet (768px)?
- [ ] ¿Los dropdowns y tablas no se rompen en pantallas medianas?

---

## ⚡ BLOQUE 5 — PERFORMANCE

### Backend
- [ ] ¿Las queries a la DB usan select específico? Nunca traer todos los campos
      Prisma: select: { id, gestorId, score_total } — no findMany() sin select
- [ ] ¿Existen índices en todos los campos usados en WHERE y ORDER BY?
- [ ] ¿Las listas paginadas usan cursor-based pagination (no OFFSET)?
- [ ] ¿Los endpoints de dashboard/KPIs tienen caché en Redis?
- [ ] ¿El procesamiento de audio es asíncrono con BullMQ?
      Si Whisper se llama inline en el request → problema crítico de timeout

### Frontend
- [ ] ¿Las listas largas usan virtualización? (react-virtual o similar)
- [ ] ¿Las imágenes y assets están optimizados?
- [ ] ¿Los componentes pesados usan React.lazy() y Suspense?
- [ ] ¿React Query tiene staleTime configurado para evitar refetches innecesarios?
- [ ] ¿El bundle size fue revisado? Correr: vite build --report

---

## 🔄 BLOQUE 6 — RESILIENCIA Y MANEJO DE ERRORES

### OpenAI / Servicios externos
- [ ] ¿Existe retry logic con backoff exponencial para llamadas a Whisper y GPT?
      Mínimo 3 reintentos con delays: 1s, 2s, 4s
- [ ] ¿Si GPT devuelve un JSON malformado, hay fallback y no rompe la evaluación?
- [ ] ¿Los timeouts de OpenAI están configurados explícitamente?
      Whisper: máx 120s — GPT: máx 60s
- [ ] ¿Los jobs fallidos en BullMQ se registran y notifican?

### Base de Datos
- [ ] ¿Existe manejo de errores de conexión a la DB al startup?
- [ ] ¿Las transacciones de Prisma tienen rollback correcto ante errores?
- [ ] ¿Hay connection pooling configurado?

### General
- [ ] ¿Existe un handler global de errores no capturados en Express?
      process.on('uncaughtException') y process.on('unhandledRejection')
- [ ] ¿El frontend tiene un ErrorBoundary global que evita pantalla blanca total?

---

## 📦 BLOQUE 7 — DEVOPS Y DEPLOYMENT

### Docker
- [ ] ¿El docker-compose.yml tiene healthchecks en postgres y redis?
- [ ] ¿Los contenedores tienen restart: unless-stopped?
- [ ] ¿Existe docker-compose.prod.yml con configuraciones de producción?
- [ ] ¿Las imágenes Docker usan versiones específicas (no :latest)?
- [ ] ¿El .dockerignore excluye node_modules, .env y archivos de desarrollo?

### CI/CD
- [ ] ¿Existe pipeline de CI que corre lint + tests antes de mergear?
      GitHub Actions: on push → lint → test → build
- [ ] ¿El pipeline falla si hay vulnerabilidades HIGH en npm audit?
- [ ] ¿Las variables de entorno de producción están en GitHub Secrets (no en el repo)?

### Configuración
- [ ] ¿Existe .env.example con todas las variables necesarias pero sin valores reales?
- [ ] ¿El README explica cómo levantar el proyecto desde cero en menos de 10 minutos?
- [ ] ¿Están documentados todos los comandos útiles?
      npm run dev, npm run build, npm run test, npm run migrate, npm run seed

---

## 📝 BLOQUE 8 — DOCUMENTACIÓN

- [ ] ¿El README tiene: descripción, prerequisitos, instalación, uso y variables de entorno?
- [ ] ¿Los endpoints de la API están documentados? (Swagger/OpenAPI o README)
- [ ] ¿El schema de la DB está documentado con descripción de cada tabla y campo?
- [ ] ¿El proceso de migración está explicado paso a paso?
- [ ] ¿Los componentes complejos del frontend tienen comentarios de uso?
- [ ] ¿Está documentado cómo integrar Azure AD cuando llegue el momento?
- [ ] ¿Existe un CHANGELOG.md con las versiones y cambios?

---

## 🚀 BLOQUE 9 — CHECKLIST DE LANZAMIENTO

Antes de considerar el producto listo para usuarios reales verificar:

- [ ] npm audit sin vulnerabilidades HIGH/CRITICAL en front y back
- [ ] Todos los tests pasan (npm test en front y back)
- [ ] Build de producción sin errores (npm run build)
- [ ] Variables de entorno de producción configuradas y validadas
- [ ] Base de datos migrada con prisma migrate deploy
- [ ] Seed de datos iniciales ejecutado (usuario admin)
- [ ] Docker Compose levanta todo el stack sin errores
- [ ] Flujo completo testeado manualmente end-to-end:
      Login → subir MP3 → transcripción → scoring → análisis deudor → exportar PDF
- [ ] El dashboard muestra datos correctos según el rol del usuario
- [ ] Los errores de OpenAI muestran mensajes amigables (no crashes)
- [ ] El PDF exportado coincide con el formato oficial de la empresa
- [ ] Logs funcionando y sin datos sensibles

---

## 📋 FORMATO DE RESPUESTA ESPERADO

Para cada problema encontrado reportá así:

### 🔴 CRÍTICO — [Nombre]
- Archivo y línea exacta
- Qué está mal y por qué es un problema
- Impacto en el producto o el usuario
- Fix concreto con código de ejemplo

### 🟠 ALTO — [Nombre]
### 🟡 MEDIO — [Nombre]
### 🔵 BAJO / MEJORA — [Nombre]
### ✅ OK — [Bloque auditado sin problemas]

---

## 🎯 ENTREGABLE FINAL

1. Reporte completo con todos los hallazgos ordenados por severidad
2. Fix inmediato del código para todos los ítems CRÍTICOS y ALTOS
3. Lista de deuda técnica (MEDIO y BAJO) para el backlog
4. Score de calidad general del producto del 1 al 10 con justificación
5. Top 3 riesgos del producto si se lanza tal como está hoy
```

---

Guardalo como `QUALITY_AUDIT_PROMPT.md` en la raíz del proyecto. Para usarlo:
```
@workspace seguí las instrucciones de QUALITY_AUDIT_PROMPT.md
y auditá todo el proyecto completo