# Short EXP Manager

ระบบจัดการสินค้า Short EXP สำหรับ Location `60008` ⇄ `60008-EXP` — เชื่อม **Supabase** (Postgres cloud) เพื่อให้ทุกเครื่อง/ทุกคนเห็นข้อมูลเดียวกัน

## Setup ครั้งแรก (one-time)

### 1. สร้าง Supabase project

1. ไปที่ https://supabase.com → Sign up (ฟรี)
2. กด **New project** → ตั้งชื่อ (เช่น `drph-exp`) → ตั้งรหัสผ่าน DB → Region: `Southeast Asia (Singapore)` → Create
3. รอ ~2 นาทีให้ provision เสร็จ

### 2. สร้าง tables

1. ใน Supabase → เมนูซ้าย → **SQL Editor** → กด **+ New query**
2. เปิดไฟล์ [supabase-schema.sql](supabase-schema.sql) จาก repo นี้ → ก๊อปทั้งหมด → วาง → กด **Run**
3. ควรเห็น `Success. No rows returned.`

### 3. หา API credentials

1. ใน Supabase → เมนูซ้าย → **Project Settings** → **API**
2. ก๊อปค่า 2 ตัว:
   - `Project URL` (เช่น `https://abcdefgh.supabase.co`)
   - `anon public` key (string ยาวขึ้นต้นด้วย `eyJhbGci...`)

### 4. ตั้ง env vars บน Vercel

1. ไปที่ Vercel Project → **Settings** → **Environment Variables**
2. เพิ่ม 2 ตัว (เลือก Environment: Production + Preview + Development):
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://abcdefgh.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
   ```
3. ไปที่ **Deployments** → กด **⋯** บนตัวล่าสุด → **Redeploy** (ต้อง redeploy ให้ env vars มีผล)

### 5. ใช้งาน

เปิด URL → upload Item Master + Ledger ครั้งแรก → ทุกเครื่อง/อุปกรณ์ที่เปิด URL เดียวกันจะเห็นข้อมูลเหมือนกันทันที

---

## Workflow ประจำวัน

| ขั้นตอน | ทำที่ไหน | เกิดอะไร |
|---|---|---|
| **เช้า** Upload Ledger ใหม่จาก BC/D365 | แท็บ 3 | Remaining สะท้อนยอดขายเมื่อวาน + auto-detect ลังที่ D365 post แล้ว → mark Applied |
| **ระหว่างวัน** สแกนสินค้า → เพิ่มลงลัง | แท็บ 1 | จองยอดทันที, Available = Remaining − Reserved |
| **ปิดลัง** | แท็บ 1 | Auto-assign `TO08EXP-####` (เริ่ม 0001, +1 ทุกลัง) |
| **พิมพ์ใบปะหน้า / Export Excel** | แท็บ 2 | Print PDF ผ่าน browser, download Excel ตามฟอร์แมต BC import |

### 3 สถานะของ Transfer

| สถานะ | จอง qty? | ตอนไหน |
|---|---|---|
| 🟡 **เปิดอยู่** | ใช่ | กำลังสร้างลัง |
| 🔵 **รอ D365** | ใช่ | ปิดลัง + export Excel แล้ว ยังไม่ post เข้า D365 |
| 🟢 **Applied** | ไม่ | Ledger ใหม่ที่ upload มามี External Doc No. นั้น = D365 post ให้แล้ว |

**สูตร:** `Available = Ledger.Remaining − Σ(qty ของลังที่ยังไม่ Applied)`

---

## Local dev

```bash
cp .env.example .env.local
# แก้ค่า NEXT_PUBLIC_SUPABASE_URL และ NEXT_PUBLIC_SUPABASE_ANON_KEY
npm install
npm run dev
```

---

## Tech stack

- **Next.js 14** (App Router, static export → Vercel)
- **Supabase** (Postgres + REST + RLS)
- **TypeScript + Tailwind CSS**
- **SheetJS (xlsx)** — parse / export Excel
- ใบปะหน้าลังพิมพ์ผ่าน browser print (รองรับภาษาไทย, save as PDF ได้)

## Security

Schema ใช้ RLS policy แบบเปิด (anon role อ่าน/เขียนได้เต็มที่) — เหมาะกับ internal app
หากต้องการปิดสาธารณะ: เพิ่ม **Vercel Password Protection** ในระดับ deployment
หรือเขียน RLS policy ใหม่ผูกกับ Supabase Auth (เกินขอบเขต MVP)
