export type SearchOption={value:string;label:string;meta?:string;keywords?:string};
export function normalizeOptionSearch(value:string){return value.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().trim().replace(/\s+/g,' ');}
export function filterSearchOptions<T extends SearchOption>(options:T[],query:string):T[]{
 const words=normalizeOptionSearch(query).split(' ').filter(Boolean);if(!words.length)return options;
 return options.filter(option=>{const text=normalizeOptionSearch([option.label,option.value,option.meta||'',option.keywords||''].join(' '));return words.every(word=>text.includes(word));});
}
