"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";

export function ProductionDialog({trigger,title,description,children}:{trigger:string;title:string;description:string;children:ReactNode}) {
  const [open,setOpen]=useState(false);
  const closeRef=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    if(!open)return;
    const onKey=(event:KeyboardEvent)=>{if(event.key==="Escape")setOpen(false);};
    document.addEventListener("keydown",onKey);document.body.style.overflow="hidden";closeRef.current?.focus();
    return()=>{document.removeEventListener("keydown",onKey);document.body.style.overflow="";};
  },[open]);
  return <>
    <button type="button" className="rounded-xl bg-forest px-4 py-2.5 text-sm font-semibold text-cream shadow-sm transition hover:bg-forest-light focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest" onClick={()=>setOpen(true)}>{trigger}</button>
    {open&&<div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-forest/45 p-4 pt-[10vh]" onMouseDown={event=>{if(event.currentTarget===event.target)setOpen(false)}}>
      <section role="dialog" aria-modal="true" aria-labelledby="production-dialog-title" aria-describedby="production-dialog-description" className="w-full max-w-xl rounded-2xl border border-white/30 bg-cream p-6 shadow-2xl">
        <div className="mb-6 flex items-start justify-between gap-4"><div><h2 id="production-dialog-title" className="text-xl font-semibold">{title}</h2><p id="production-dialog-description" className="mt-1 text-sm text-forest/65">{description}</p></div><button ref={closeRef} type="button" onClick={()=>setOpen(false)} className="rounded-lg px-2 py-1 text-xl leading-none text-forest/60 hover:bg-forest/5" aria-label="Close">×</button></div>
        {children}
      </section>
    </div>}
  </>;
}
