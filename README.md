# CallScorerRYMSAI — Recuperos y Mandatos

Sistema de evaluación de llamadas de cobranza con transcripción Whisper y scoring GPT-4o.

## Requisitos
- Node.js 20+
- PostgreSQL 15+
- Cuenta OpenAI con acceso a Whisper y GPT-4o

---

## 🚀 Inicio rápido (desarrollo local)

### 1. Variables de entorno

```bash
# Backend
cp backend/.env.example backend/.env
# Editar: DATABASE_URL, OPENAI_API_KEY, JWT_SECRET

# Frontend
cp frontend/.env.example frontend/.env
```

### 2. Backend

```bash
cd backend
npm install

# Generar cliente Prisma y migrar BD
npm run prisma:generate
npm run prisma:migrate    # Escribe el nombre: "init"

# Seed: crea usuario admin + gestores de ejemplo
npm run prisma:seed

# Iniciar en modo desarrollo
npm run dev
```

Backend disponible en: http://localhost:3001

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend disponible en: http://localhost:5173

### 4. Credenciales por defecto

```
Email:    admin@recuperosymandatos.com
Password: Admin1234

Gestor de prueba:
Email:    gestor.prueba@recuperosymandatos.com
Password: Gestor1234
```

---

## 🐳 Docker Compose (stack completo)

```bash
# Copiar y configurar variables
cp .env.example .env
# Editar .env: OPENAI_API_KEY, JWT_SECRET

docker-compose up --build
```

Servicios:
- Frontend: http://localhost:5173
- Backend API: http://localhost:3001
- Redis: redis://localhost:6379
- Worker: procesamiento async de audio/IA

## Migraciones

- Desarrollo: `npm run prisma:migrate`
- Producción: `npx prisma migrate deploy`
- Nunca usar `prisma db push` en producción

---

## 📁 Estructura del proyecto

```
/
├── backend/                    # Node.js + Express + TypeScript
│   ├── src/
│   │   ├── routes/             # auth, evaluaciones, gestores, dashboard
│   │   ├── services/           # whisper, scoring, debtor-analysis, pdf, auth
│   │   ├── middleware/         # auth JWT, roles, upload multer
│   │   ├── prisma/             # schema.prisma + seed.ts
│   │   ├── lib/prisma.ts       # cliente Prisma singleton
│   │   └── index.ts            # servidor Express
│   ├── uploads/                # archivos MP3 subidos
│   └── Dockerfile
│
├── frontend/                   # React + Vite + TailwindCSS
│   ├── src/
│   │   ├── pages/              # Login, Dashboard, NewEvaluation, EvaluationDetail
│   │   ├── components/         # AudioUploader, TranscriptViewer, ScoringTable, etc.
│   │   ├── hooks/              # useAuth, useEvaluation
│   │   ├── services/           # api.service.ts (todos los calls al backend)
│   │   └── main.tsx
│   ├── nginx.conf
│   └── Dockerfile
│
└── docker-compose.yml
```

---

## 🔌 Endpoints principales

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | /api/v1/auth/login | Login JWT |
| GET | /api/v1/evaluaciones | Listar con filtros |
| POST | /api/v1/evaluaciones | Crear evaluación |
| POST | /api/v1/evaluaciones/:id/upload-audio | Subir MP3 + Whisper |
| POST | /api/v1/evaluaciones/:id/score | Scoring GPT-4o |
| POST | /api/v1/evaluaciones/:id/analyze-debtor | Análisis deudor GPT-4o |
| GET | /api/v1/evaluaciones/:id/export-pdf | Exportar PDF |
| GET | /api/v1/dashboard/kpis | KPIs del dashboard |

---

## 🔮 Integración futura con Azure AD

El servicio `backend/src/services/auth.service.ts` está diseñado como capa de abstracción.
Para migrar a MSAL.js + Azure AD:
1. Reemplazar `login()` con validación de token MSAL
2. El hook `frontend/src/hooks/useAuth.ts` también tiene la misma interfaz abstracta
3. No se requieren cambios en rutas ni componentes

---

## 🎨 Paleta de colores

| Color | Hex | Uso |
|-------|-----|-----|
| Rojo corporativo | `#CC0000` | Header, botones primarios, marca |
| Gris oscuro | `#333333` | Textos |
| Verde | `#16a34a` | CUMPLE, score ≥80% |
| Naranja | `#ea580c` | Score 60-79% |
| Rojo | `#CC0000` | NO_CUMPLE, score <60% |
