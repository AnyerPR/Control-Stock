import React, { useRef, useState, useCallback } from "react";

interface MarqueeTextProps {
  text: string;
  className?: string;
  textClassName?: string;
}

function MarqueeTextInner({ text, className = "", textClassName = "" }: MarqueeTextProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [shouldScroll, setShouldScroll] = useState(false);
  const checkedRef = useRef<string>("");

  const handleCheckOverflow = useCallback(() => {
    if (text.length < 24) return;
    if (checkedRef.current === text) return;
    checkedRef.current = text;
    if (containerRef.current && textRef.current) {
      const hasOverflow = textRef.current.scrollWidth > containerRef.current.clientWidth;
      if (hasOverflow) {
        setShouldScroll(true);
      }
    }
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
    <div
      ref={containerRef}
      onMouseEnter={handleCheckOverflow}
      onTouchStart={handleCheckOverflow}
      className={`overflow-hidden truncate w-full ${className}`}
      title={text}
    >
      <span ref={textRef} className={`block truncate ${textClassName}`}>
        {text}
      </span>
    </div>
  );
}

const MarqueeText = React.memo(MarqueeTextInner);
export default MarqueeText;
