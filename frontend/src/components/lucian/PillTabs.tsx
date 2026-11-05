// Lucian UX/UI #039 · MIT (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#039
import { useId, useRef } from 'react';
import type { KeyboardEvent } from 'react';
export function PillTabs<T extends string>({ options,value,onChange,label,panelId }:{ options:Array<{value:T;label:string}>;value:T;onChange:(value:T)=>void;label:string;panelId?:string }) {
 const root=useRef<HTMLDivElement>(null);const id=useId();
 function key(event:KeyboardEvent,index:number){
  const next=event.key==='ArrowRight'?(index+1)%options.length:event.key==='ArrowLeft'?(index+options.length-1)%options.length:event.key==='Home'?0:event.key==='End'?options.length-1:-1;
  if(next<0)return;event.preventDefault();onChange(options[next].value);root.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
 }
 return <div className="app-tabs" ref={root}><div role="tablist" aria-label={label}>{options.map((option,index)=><button key={option.value} id={id+'-'+index} type="button" role="tab" aria-selected={value===option.value} aria-controls={panelId} tabIndex={value===option.value?0:-1} onClick={()=>onChange(option.value)} onKeyDown={event=>key(event,index)}>{option.label}</button>)}</div></div>;
}
