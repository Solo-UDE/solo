import { useEffect, useState, type FC } from 'react';

const FRAMES = ['', '.', '..', '...'];

export const AgentAnimatedDots: FC = () => {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % FRAMES.length), 400);
    return () => clearInterval(id);
  }, []);

  return <span className="inline-block w-4 text-left">{FRAMES[frame]}</span>;
};
