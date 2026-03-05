import { motion } from 'framer-motion';
import { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  hover?: boolean;
}

export default function Card({
  children,
  className = '',
  onClick,
  hover = false,
}: CardProps) {
  const baseStyles = 'bg-white rounded-xl shadow-md p-6';
  const interactiveStyles = onClick || hover ? 'cursor-pointer' : '';
  
  return (
    <motion.div
      onClick={onClick}
      whileHover={hover || onClick ? { y: -2, shadow: 'lg' } : {}}
      transition={{ duration: 0.2 }}
      className={`${baseStyles} ${interactiveStyles} ${className}`}
    >
      {children}
    </motion.div>
  );
}
