import { useEffect, useRef, useState } from "react";

interface MarqueeTextProps {
  text: string;
  className?: string;
  textClassName?: string;
}

export default function MarqueeText({ text, className = "", textClassName = "" }: MarqueeTextProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [shouldScroll, setShouldScroll] = useState(false);

  useEffect(() => {
    if (text.length < 18) {
      setShouldScroll(false);
      return;
    }

    const checkScroll = () => {
      if (containerRef.current && textRef.current) {
        const hasOverflow = textRef.current.scrollWidth > containerRef.current.clientWidth;
        setShouldScroll(hasOverflow);
      }
    };

    checkScroll();
    window.addEventListener("resize", checkScroll);
    const timer = setTimeout(checkScroll, 150);

    return () => {
      window.removeEventListener("resize", checkScroll);
      clearTimeout(timer);
    };
  }, [text]);

  if (shouldScroll) {
    return (
      <div
        ref={containerRef}
        className={`overflow-hidden relative w-full whitespace-nowrap select-none ${className}`}
        title={text}
      >
        <div className="inline-flex w-max hover:[animation-play-state:paused] active:[animation-play-state:paused]">
          <span ref={textRef} className={`inline-block pr-12 animate-marquee shrink-0 ${textClassName}`}>
            {text}
          </span>
          <span className={`inline-block pr-12 animate-marquee shrink-0 ${textClassName}`} aria-hidden="true">
            {text}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={`overflow-hidden truncate w-full ${className}`} title={text}>
      <span ref={textRef} className={`block truncate ${textClassName}`}>
        {text}
      </span>
    </div>
  );
}
