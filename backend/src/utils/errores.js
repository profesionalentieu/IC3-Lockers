'use strict';
/**
 * Error de negocio: lo lanzan los servicios y el errorHandler lo traduce
 * al codigo HTTP correspondiente. Vive aparte para que cualquier servicio
 * pueda usarlo sin crear dependencias circulares entre ellos.
 */
class ErrorNegocio extends Error {
  constructor(mensaje, codigo = 400) {
    super(mensaje);
    this.nombre = 'ErrorNegocio';
    this.codigo = codigo;
  }
}

module.exports = { ErrorNegocio };
