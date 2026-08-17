/**
 * A interface tem uma fonte única: ../server/public.
 * Este script copia ela para desktop/renderer antes de rodar/empacotar o app,
 * para não existirem duas versões do mesmo HTML.
 */
const fs = require('fs');
const path = require('path');

const from = path.join(__dirname, '..', 'server', 'public');
const to = path.join(__dirname, 'renderer');

fs.rmSync(to, { recursive: true, force: true });
fs.cpSync(from, to, { recursive: true });
console.log(`interface copiada: ${from} -> ${to}`);
