'use strict';
/** Logger minimo con timestamp. Suficiente para el MVP. */
const marca = () => new Date().toISOString().slice(11, 19);

module.exports = {
  info: (...args) => console.log(`[${marca()}] INFO `, ...args),
  aviso: (...args) => console.warn(`[${marca()}] AVISO`, ...args),
  error: (...args) => console.error(`[${marca()}] ERROR`, ...args),
  lora: (...args) => console.log(`[${marca()}] LORA `, ...args),
};
