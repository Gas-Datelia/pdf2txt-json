import { Type } from "@google/genai";

export const AI_CONFIG_CHUNKED = {
  model: "gemini-2.5-flash",
  temperature: 0.1,
  maxOutputTokens: 8192,
  prompts: {
    json_extraction: `MISIÓN: Extraer EXCLUSIVAMENTE los datos visibles en ESTA PÁGINA del pedido.

REGLAS:
1. Extrae solo las sucursales y líneas de producto visibles en esta imagen.
2. Si una tabla continúa de la página anterior SIN encabezado de destino/sucursal, usa sucursal_nombre: "continuacion_pagina_anterior".
3. Si hay encabezado de destino, usa el nombre exacto.
4. Fechas: YYYY-MM-DD. Números: valores numéricos con punto decimal.

IMPORTANTE — CLIENTE vs PROVEEDOR:
- El CLIENTE es la empresa que EMITE el pedido (aparece como logo/nombre principal del documento, ej: "ALBERDI"). Ponlo en "cliente_nombre".
- El PROVEEDOR es la empresa a quien va dirigido el pedido (aparece bajo "Proveedor:" en el encabezado). Ponlo en "proveedor_nombre".
- NUNCA pongas el proveedor como cliente ni viceversa.

IMPORTANTE — COLUMNAS DE LA TABLA DE PRODUCTOS:
La tabla tiene estas columnas: Código | Cód.Prov | Descripción | P.Lista | Variaciones | P.Unit | I.I. | UxB | Cant. | UMP | Total
- "codigo": El código interno del producto (primera columna numérica).
- "codigo_provincial": El "Cód.Prov" (segunda columna numérica). NO lo mezcles con la descripción.
- "descripcion": SOLO el texto descriptivo del producto. NO incluyas el código provincial al inicio.
- "uxb": Unidades por bulto.
- "cantidad": La cantidad pedida.
- "ump": Unidad de medida (BTO, KG, UN, CJ).

TOTALES: Solo extrae totales_verificacion si están impresos en ESTA página. Si no los ves, devuelve 0 en todos.
Nunca inventes datos. Solo extrae lo que ves.`,
    text_extraction: "Extrae todo el texto de esta página de forma limpia y clara."
  },
  schemas: {
    order_extraction: {
      type: Type.OBJECT,
      properties: {
        pagina_numero: { type: Type.NUMBER },
        cliente_nombre: { type: Type.STRING, nullable: true },
        proveedor_nombre: { type: Type.STRING, nullable: true },
        numero_pedido: { type: Type.STRING, nullable: true },
        fecha_pedido: { type: Type.STRING, nullable: true },
        fecha_entrega: { type: Type.STRING, nullable: true },
        moneda: { type: Type.STRING, nullable: true },
        sucursales: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              sucursal_nombre: { type: Type.STRING },
              items: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    codigo: { type: Type.STRING },
                    codigo_provincial: { type: Type.STRING, nullable: true },
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
      required: ["pagina_numero", "sucursales", "totales_verificacion"]
    }
  }
};
