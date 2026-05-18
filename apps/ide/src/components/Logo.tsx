import React from 'react';

interface LogoProps {
  size?: number;
  className?: string;
}

export const Logo: React.FC<LogoProps> = ({ size = 32, className }) => {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 512 512" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        d="M256 72 C186 72 120 146 120 256 C120 366 186 440 256 440 C326 440 392 366 392 256 C392 146 326 72 256 72 Z"
        stroke="#2563eb"
        strokeWidth="28"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M256 116 C220 150 220 210 256 256 C292 302 292 362 256 396"
        stroke="#3b82f6"
        strokeWidth="18"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
};

export const LogoIcon: React.FC<LogoProps> = ({ size = 24, className }) => {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 512 512" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        d="M256 72 C186 72 120 146 120 256 C120 366 186 440 256 440 C326 440 392 366 392 256 C392 146 326 72 256 72 Z"
        stroke="#2563eb"
        strokeWidth="28"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M256 116 C220 150 220 210 256 256 C292 302 292 362 256 396"
        stroke="#3b82f6"
        strokeWidth="18"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
};

export default Logo;
