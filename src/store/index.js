// Saqlash qatlamining yagona kirish nuqtasi. Qolgan kod faqat shu yerdan
// import qiladi — baza almashsa (masalan boshqa SQL yoki fayl), o'zgarish
// shu papkadan tashqariga chiqmaydi.
export { getDb } from './db.js';
export * from './users.js';
export * from './connections.js';
export * from './board.js';
export * from './dot.js';
export * from './notes.js';
export { DEFAULT_CONFIG, ValidationError, validRowKey, COLORS } from './boardModel.js';
