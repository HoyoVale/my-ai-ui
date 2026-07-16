export function PetSprite({
  src,
  dragHandlers
}) {
  return (
    <img
      className="pet__image"
      src={src}
      alt="Xixi desktop pet"
      draggable={false}
      {...dragHandlers}
    />
  );
}
