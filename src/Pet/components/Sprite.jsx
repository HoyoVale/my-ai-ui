export function PetSprite({
  src,
  dragHandlers
}) {
  return (
    <img
      className="pet__image"
      data-testid="pet-sprite"
      src={src}
      alt="Xixi desktop pet"
      draggable={false}
      {...dragHandlers}
    />
  );
}
