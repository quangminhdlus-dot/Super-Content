export type Segment = { id: number; text: string; start: number; end: number };
export type Decision = {index:number; confidence:number; accepted:boolean; reason:string};
export function normalize(text: string): string {
  return text.toLocaleLowerCase('vi').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
}
