import React from 'react';

export default function SectionTitle({ eyebrow, title, text, center = false, className = '', style }) {
  return (
    <div className={`${center ? 'text-center max-w-2xl mx-auto' : 'max-w-2xl'} ${className}`} style={style}>
      {eyebrow && <p className="text-xs font-bold uppercase tracking-[0.16em] text-indigo-600 dark:text-indigo-400">{eyebrow}</p>}
      <h2 className="mt-2 text-2xl sm:text-[2rem] font-extrabold tracking-tight text-slate-900 dark:text-white">{title}</h2>
      {text && <p className="mt-3 text-slate-500 dark:text-slate-400">{text}</p>}
    </div>
  );
}
