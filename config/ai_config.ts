import { Type } from "@google/genai";

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export const AI_CONFIG = {
  model: "gemini-3.1-pro-preview",
  temperature: 1.0,
  maxOutputTokens: 65536,
  prompts: {
    json_extraction: `MISIÓN CRÍTICA: Extracción de datos empresariales con CERO pérdida.

REGLAS ABSOLUTAS — VIOLACIÓN = FALLO TOTAL:
1. Este pedido contiene DECENAS de sucursales/destinos y CIENTOS de líneas de producto. DEBES extraer ABSOLUTAMENTE TODAS.
2. NO te detengas después de 3, 5 o 10 sucursales. Recorre CADA PÁGINA del documento de principio a fin.
3. Cada vez que veas un encabezado de "Destino:" o "Sucursal:" o cambio de dirección de entrega, es una sucursal nueva.
4. Dentro de cada sucursal, extrae CADA línea de la tabla de productos. Si una tabla continúa en la siguiente página, SIGUE extrayendo.
5. Si el pedido tiene UN SOLO destino/sucursal, usa sucursal_nombre: "unica" y es_multisucursal: false.
6. Si tiene MÚLTIPLES destinos, usa es_multisucursal: true y el nombre real de cada sucursal.
7. Fechas en formato YYYY-MM-DD. Números como valores numéricos con punto decimal.
8. El campo "ump" es la unidad de medida/presentación (BU=bulto, KG=kilos, UN=unidades, CJ=caja).
9. El campo "uxb" es unidades por bulto/caja.
10. Al terminar, verifica internamente: ¿extraje TODAS las sucursales? ¿TODOS los items de cada tabla? Si falta algo, VUELVE y complétalo antes de responder.

RECORDATORIO FINAL: Tu respuesta será validada automáticamente contra los totales del documento. Si el conteo de items o sucursales no coincide, el sistema marcará ERROR. NO seas perezoso. Extrae TODO.`,
    text_extraction: "Extrae TODO el texto de este pedido de forma limpia y clara. No omitas ninguna línea de producto ni detalle. NO incluyas texto introductorio ni comentarios, solo el contenido del pedido."
  },
  schemas: {
    order_extraction: {
      type: Type.OBJECT,
      properties: {
        cliente_nombre: { type: Type.STRING },
        numero_pedido: { type: Type.STRING },
        fecha_pedido: { type: Type.STRING },
        fecha_entrega: { type: Type.STRING, nullable: true },
        moneda: { type: Type.STRING },
        es_multisucursal: { type: Type.BOOLEAN },
        sucursales: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              sucursal_codigo: { type: Type.STRING, nullable: true },
              sucursal_nombre: { type: Type.STRING },
              sucursal_direccion: { type: Type.STRING, nullable: true },
              items: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    codigo: { type: Type.STRING },
                    descripcion: { type: Type.STRING },
                    uxb: { type: Type.NUMBER, nullable: true },
                    cantidad: { type: Type.NUMBER },
                    ump: { type: Type.STRING, nullable: true }
                  },
                  required: ["codigo", "descripcion", "cantidad"]
                }
              }
            },
            required: ["sucursal_nombre", "items"]
          }
        },
        totales_verificacion: {
          type: Type.OBJECT,
          properties: {
            total_neto: { type: Type.NUMBER },
            imp_int: { type: Type.NUMBER },
            iva: { type: Type.NUMBER },
            total: { type: Type.NUMBER }
          },
          required: ["total_neto", "total"]
        }
      },
      required: ["cliente_nombre", "numero_pedido", "sucursales", "totales_verificacion"]
    }
  }
};
