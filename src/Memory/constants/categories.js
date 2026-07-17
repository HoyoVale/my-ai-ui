export const MEMORY_CATEGORY_OPTIONS = [
  {
    value: "all",
    label: "全部"
  },
  {
    value: "profile",
    label: "资料"
  },
  {
    value: "preference",
    label: "偏好"
  },
  {
    value: "project",
    label: "项目"
  },
  {
    value: "constraint",
    label: "约束"
  },
  {
    value: "other",
    label: "其他"
  }
];

export const MEMORY_CATEGORY_LABELS =
  Object.fromEntries(
    MEMORY_CATEGORY_OPTIONS
      .filter(
        (item) =>
          item.value !== "all"
      )
      .map((item) => [
        item.value,
        item.label
      ])
  );
