"use client";

import { Info } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface MetricInfoProps {
  title: string;
  description: string;
  calculation?: string;
  whyItMatters?: string;
}

export function MetricInfo({
  title,
  description,
  calculation,
}: MetricInfoProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function close(event: MouseEvent) {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", close);

    return () => {
      document.removeEventListener("mousedown", close);
    };
  }, []);

  const text = calculation
    ? `${description} ${calculation}`
    : description;

  return (
    <div ref={wrapperRef} className="relative inline-flex">
      <button
        type="button"
        aria-label={`About ${title}`}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
        }}
        className="inline-flex h-4 w-4 items-center justify-center text-slate-400 transition hover:text-slate-700 dark:hover:text-slate-200"
      >
        <Info className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div
          onClick={(event) => event.stopPropagation()}
          className="absolute left-1/2 top-6 z-[100] w-60 -translate-x-1/2 rounded-lg border border-slate-200 bg-white p-3 normal-case tracking-normal shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          <p className="text-xs font-semibold text-slate-900 dark:text-white">
            {title}
          </p>

          <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-300">
            {text}
          </p>
        </div>
      )}
    </div>
  );
}