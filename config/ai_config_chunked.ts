import { Type } from "@google/genai";

export const AI_CONFIG_CHUNKED = {
  model: "gemini-2.5-flash",
  temperature: 0.1,
  maxOutputTokens: 65536,
  prompts: {
    json_extraction: `MISIÓN: Extraer EXCLUSIVAMENTE los datos visibles en ESTA PÁGINA del pedido.

REGLA CRÍTICA DE COMPLETITUD:
- EXTRAÉ ABSOLUTAMENTE TODAS las filas de producto de la tabla. Cada fila que tenga un código numérico en la primera columna es un item que DEBE ser extraído.
- NO OMITAS NINGUNA FILA. NO RESUMAS. NO AGRUPES.
- Si hay 25 filas en la tabla, deben aparecer 25 items en el JSON.

REGLAS GENERALES:
1. Extrae solo las sucursales y líneas de producto visibles en esta imagen.
2. Si una tabla continúa de la página anterior SIN encabezado de destino/sucursal, usa sucursal_nombre: "continuacion_pagina_anterior".
3. Fechas: YYYY-MM-DD. Números: valores numéricos con punto decimal.

IMPORTANTE — SUCURSAL:
- sucursal_nombre debe ser la COPIA EXACTA Y COMPLETA de toda la línea "Destino:" tal cual aparece en el encabezado.
- Ejemplo: si dice "Destino: CO01 Comodin 1 - Necochea 445 - San Salvador de Jujuy", entonces sucursal_nombre = "CO01 Comodin 1 - Necochea 445 - San Salvador de Jujuy"
- NO lo recortes, NO lo abrevies. Copiá todo el texto después de "Destino:".

IMPORTANTE — CLIENTE vs PROVEEDOR:
- El CLIENTE es la empresa que EMITE el pedido (aparece como logo/nombre principal del documento, ej: "ALBERDI"). Ponlo en "cliente_nombre".
- El PROVEEDOR es la empresa a quien va dirigido el pedido (aparece bajo "Proveedor:" en el encabezado). Ponlo en "proveedor_nombre".
- NUNCA pongas el proveedor como cliente ni viceversa.

IMPORTANTE — COLUMNAS DE LA TABLA DE PRODUCTOS (orden izquierda a derecha):
Columna 1: "Código" → va en "codigo"
Columna 2: "Cód.Prov" → va en "codigo_provincial"
Columna 3: "Descripción" → va en "descripcion" (SOLO texto, sin códigos)
Columnas 4-7: P.Lista, Variaciones, P.Unit, I.I. → NO EXTRAER
Columna 8: "UxB" → va en "uxb" (unidades por bulto, suele ser 1, 10, 70, 100)
Columna 9: "Cant." → va en "cantidad" (cantidad de bultos pedidos, suele ser números como 1,0  2,0  4,0  5,0  15,0  20,0)
Columna 10: "UMP" → va en "ump"
Columna 11: "Total" → NO EXTRAER

⚠️⚠️⚠️ REGLA CRÍTICA — UxB vs Cant. ⚠️⚠️⚠️
"uxb" y "cantidad" son DOS columnas DIFERENTES que están una al lado de la otra.
- "uxb" (columna 8) = unidades por bulto. Está a la IZQUIERDA.
- "cantidad" (columna 9) = bultos pedidos. Está a la DERECHA de UxB.

EJEMPLOS CONCRETOS de la tabla:
| ... | UxB | Cant. | UMP |
|     |  70 |  5,0  | BTO |  → uxb=70, cantidad=5   (NO cantidad=70)
|     |   1 | 15,0  | BTO |  → uxb=1,  cantidad=15  (NO cantidad=1)
|     |  10 |  1,0  | BTO |  → uxb=10, cantidad=1   (NO cantidad=10)
|     |   1 | 20,0  | BTO |  → uxb=1,  cantidad=20

Si ves "70" seguido de "5,0", entonces uxb=70 y cantidad=5. El número con decimales (5,0) es SIEMPRE la cantidad pedida.

TOTALES: Solo extrae totales_verificacion si están impresos en ESTA página (ej: "Sub Total", "Total Neto", "IVA", "Total"). Si no los ves, devuelve 0 en todos.
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
