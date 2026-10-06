// Testlar .env ga bog'liq bo'lmasin: kerakli muhitni shu yerda beramiz
// (config.js import qilinishidan OLDIN — shuning uchun --import orqali).
process.env.SECRET_KEY = 'test-secret';
process.env.DATABASE_URL = '';
process.env.NODE_ENV = 'test';
process.env.RENDER = '';
