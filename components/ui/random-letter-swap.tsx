"use client";

import React, { useState, useEffect, useRef } from "react";
import { motion, type Transition } from "framer-motion";
import { cn } from "@/lib/utils";

interface RandomLetterSwapProps {
  label: string;
  className?: string;
  staggerDuration?: number;
  transition?: Transition;
  characters?: string;
}

const DEFAULT_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";

export function RandomLetterSwap({
  label,
  className,
  staggerDuration = 0.025,
  transition = { duration: 0.6, type: "spring" },
  characters = DEFAULT_CHARS,
}: RandomLetterSwapProps) {
  const [displayText, setDisplayText] = useState(label);
  const [isHovered, setIsHovered] = useState(false);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    setDisplayText(label);
  }, [label]);

  const startScramble = () => {
    setIsHovered(true);
    let iteration = 0;
    const maxIterations = label.length;

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    const scramble = () => {
      setDisplayText((prev) =>
        label
          .split("")
          .map((letter, index) => {
            if (index < iteration) {
              return label[index];
            }
            if (letter === " ") return " ";
            return characters[Math.floor(Math.random() * characters.length)];
          })
          .join("")
      );

      if (iteration < maxIterations) {
        iteration += 1 / 3;
        animationFrameRef.current = requestAnimationFrame(scramble);
      } else {
        setDisplayText(label);
      }
    };

    animationFrameRef.current = requestAnimationFrame(scramble);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    setDisplayText(label);
  };

  return (
    <motion.span
      className={cn("inline-flex select-none font-mono", className)}
      onMouseEnter={startScramble}
      onMouseLeave={handleMouseLeave}
      transition={transition}
    >
      {displayText.split("").map((char, index) => (
        <motion.span
          key={index}
          className="inline-block"
          initial={{ y: 0 }}
          animate={isHovered ? { y: [0, -2, 0] } : { y: 0 }}
          transition={{
            duration: 0.2,
            delay: index * staggerDuration,
            ease: "easeInOut",
          }}
        >
          {char === " " ? "\u00A0" : char}
        </motion.span>
      ))}
    </motion.span>
  );
}
