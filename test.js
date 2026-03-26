import axios from 'axios';
axios.post('http://localhost:3000/api/extract', {
  url: 'https://dzzizjwrrncifohammdu.supabase.co/storage/v1/object/public/uploads/pdf/Orden_de_Compra_11_paginas.pdf',
  mode: 'text'
}).then(res => console.log('Done length:', res.data.data ? res.data.data.length : res.data)).catch(console.error);
