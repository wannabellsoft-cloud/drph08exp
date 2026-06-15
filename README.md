# Short EXP Manager

ระบบจัดการสินค้า Short EXP สำหรับ Location `60008` ⇄ `60008-EXP`

## Workflow

1. **Upload Data** — อัพโหลด Item Master + Item Ledger จาก Excel (รูปแบบเดียวกับ `itemmasterdb.xlsx` และ `Database_exp08.xlsx`)
2. **Scan & Build TO** — ยิงบาร์โค้ด, ระบบจะ map ไป Item No. แล้วดึง stock ของ 2 Location จาก Ledger
   - กด `+ ลังใหม่` เพื่อเริ่ม Carton ใหม่
   - สแกนสินค้า → กดปุ่ม "โอน → 60008-EXP" สำหรับ lot ที่อยู่ 60008
   - สำหรับ lot ที่อยู่ 60008-EXP แล้ว — กด "ใส่ลง (Ref)" เพื่อบันทึกไว้ในใบปะหน้าลังเท่านั้น (ไม่ออก TO)
   - ปิดลัง → ระบุ External Document No.
3. **Transfers** — รายการลังทั้งหมด
   - พิมพ์ใบปะหน้าลัง (PDF — ใช้ระบบพิมพ์ของ Browser → Save as PDF)
   - Export Excel ตามรูปแบบ TO ของ BC (Header/Line + External Document No.)

## Tech

- Next.js 14 (App Router) + TypeScript + Tailwind
- Dexie (IndexedDB) — ข้อมูลเก็บใน Browser ของผู้ใช้
- SheetJS (xlsx) — parse / export Excel

## Local dev

```bash
npm install
npm run dev
```

## Deploy

Push to GitHub → Import to Vercel → ไม่ต้องตั้ง env (ไม่มี backend)
