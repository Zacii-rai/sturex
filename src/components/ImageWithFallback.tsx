import { useState } from 'react';
import { Package } from 'lucide-react';

interface ImageWithFallbackProps {
  src: string;
  alt: string;
  className?: string;
  label?: string;
}

export function ImageWithFallback({
  src,
  alt,
  className = 'w-full h-full object-cover',
  label,
}: ImageWithFallbackProps) {
  const [failed, setFailed] = useState(false);

  if (failed || !src) {
    return (
      <div
        role="img"
        aria-label={alt}
        className="w-full h-full flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-[#EFEFED] to-[#E3E3DF] dark:from-[#1E1E22] dark:to-[#141416] text-[#63635E] dark:text-[#A1A1AA] p-4 text-center"
      >
        <Package className="w-7 h-7 opacity-60" strokeWidth={1.5} />
        {label && <span className="text-xs font-medium truncate max-w-full">{label}</span>}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
    />
  );
}
