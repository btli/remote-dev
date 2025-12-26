"use client";

import * as React from "react";
import { format } from "date-fns";
import { Calendar as CalendarIcon, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface DateTimePickerProps {
  date: Date | undefined;
  onDateChange: (date: Date | undefined) => void;
  minDate?: Date;
  className?: string;
  placeholder?: string;
}

export function DateTimePicker({
  date,
  onDateChange,
  minDate,
  className,
  placeholder = "Pick date and time",
}: DateTimePickerProps) {
  const [isOpen, setIsOpen] = React.useState(false);

  // Generate hours (0-23)
  const hours = React.useMemo(
    () => Array.from({ length: 24 }, (_, i) => i),
    []
  );

  // Generate minutes (0-59, in 5-minute increments)
  const minutes = React.useMemo(
    () => Array.from({ length: 12 }, (_, i) => i * 5),
    []
  );

  const handleDateSelect = (selectedDate: Date | undefined) => {
    if (!selectedDate) {
      onDateChange(undefined);
      return;
    }

    // Preserve existing time or use current time
    const currentHour = date?.getHours() ?? new Date().getHours();
    const currentMinute = date?.getMinutes() ?? 0;

    const newDate = new Date(selectedDate);
    newDate.setHours(currentHour);
    newDate.setMinutes(currentMinute);
    newDate.setSeconds(0);
    newDate.setMilliseconds(0);

    onDateChange(newDate);
  };

  const handleTimeChange = (type: "hour" | "minute", value: string) => {
    if (!date) {
      // If no date selected, use today
      const newDate = new Date();
      newDate.setSeconds(0);
      newDate.setMilliseconds(0);

      if (type === "hour") {
        newDate.setHours(parseInt(value));
      } else {
        newDate.setMinutes(parseInt(value));
      }

      onDateChange(newDate);
      return;
    }

    const newDate = new Date(date);
    if (type === "hour") {
      newDate.setHours(parseInt(value));
    } else {
      newDate.setMinutes(parseInt(value));
    }

    onDateChange(newDate);
  };

  const formatHour = (hour: number) => {
    const ampm = hour >= 12 ? "PM" : "AM";
    const displayHour = hour % 12 || 12;
    return `${displayHour}:00 ${ampm}`;
  };

  const formatMinute = (minute: number) => {
    return minute.toString().padStart(2, "0");
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "w-full justify-start text-left font-normal h-8 text-xs",
            "bg-slate-800/50 border-white/10 hover:bg-slate-800 hover:border-white/20",
            !date && "text-slate-500",
            className
          )}
        >
          <CalendarIcon className="mr-2 h-3.5 w-3.5 text-violet-400" />
          {date ? (
            format(date, "PPP 'at' h:mm a")
          ) : (
            <span>{placeholder}</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="p-2.5 space-y-2.5">
          {/* Calendar */}
          <Calendar
            mode="single"
            selected={date}
            onSelect={handleDateSelect}
            disabled={(d) => minDate ? d < new Date(minDate.setHours(0, 0, 0, 0)) : false}
            initialFocus
            className="rounded-md"
            classNames={{
              months: "flex flex-col",
              month: "space-y-2",
              caption: "flex justify-center pt-0.5 relative items-center",
              caption_label: "text-xs font-medium text-white",
              nav: "space-x-1 flex items-center",
              nav_button: cn(
                "h-6 w-6 bg-transparent p-0 text-slate-400 hover:text-white hover:bg-white/10 rounded-md transition-colors"
              ),
              nav_button_previous: "absolute left-0.5",
              nav_button_next: "absolute right-0.5",
              table: "w-full border-collapse space-y-0.5",
              head_row: "flex",
              head_cell: "text-slate-500 rounded-md w-7 font-normal text-[10px]",
              row: "flex w-full mt-0.5",
              cell: cn(
                "relative p-0 text-center text-xs focus-within:relative focus-within:z-20",
                "first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md"
              ),
              day: cn(
                "h-7 w-7 p-0 font-normal text-xs rounded-md transition-colors",
                "text-slate-300 hover:bg-violet-500/20 hover:text-white",
                "focus:bg-violet-500/20 focus:text-white focus:outline-none"
              ),
              day_selected: "bg-violet-600 text-white hover:bg-violet-700 hover:text-white focus:bg-violet-700",
              day_today: "bg-slate-700 text-white",
              day_outside: "text-slate-600 opacity-50",
              day_disabled: "text-slate-600 opacity-50 cursor-not-allowed",
              day_hidden: "invisible",
            }}
          />

          {/* Divider */}
          <div className="border-t border-white/10" />

          {/* Time Picker */}
          <div className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-violet-400" />
            <span className="text-xs text-slate-400">Time:</span>

            {/* Hour Select */}
            <Select
              value={date?.getHours()?.toString()}
              onValueChange={(value) => handleTimeChange("hour", value)}
            >
              <SelectTrigger className="w-20 h-7 bg-slate-800/50 border-white/10 text-xs">
                <SelectValue placeholder="Hour" />
              </SelectTrigger>
              <SelectContent className="max-h-48 bg-slate-900/95 backdrop-blur-xl border-white/10">
                {hours.map((hour) => (
                  <SelectItem
                    key={hour}
                    value={hour.toString()}
                    className="text-xs hover:bg-violet-500/20 focus:bg-violet-500/20"
                  >
                    {formatHour(hour)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <span className="text-slate-500 text-xs">:</span>

            {/* Minute Select */}
            <Select
              value={date ? (Math.round(date.getMinutes() / 5) * 5).toString() : undefined}
              onValueChange={(value) => handleTimeChange("minute", value)}
            >
              <SelectTrigger className="w-14 h-7 bg-slate-800/50 border-white/10 text-xs">
                <SelectValue placeholder="Min" />
              </SelectTrigger>
              <SelectContent className="bg-slate-900/95 backdrop-blur-xl border-white/10">
                {minutes.map((minute) => (
                  <SelectItem
                    key={minute}
                    value={minute.toString()}
                    className="text-xs hover:bg-violet-500/20 focus:bg-violet-500/20"
                  >
                    {formatMinute(minute)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Quick time buttons */}
          <div className="flex flex-wrap gap-1">
            {[
              { label: "Now", offset: 0 },
              { label: "+5m", offset: 5 },
              { label: "+15m", offset: 15 },
              { label: "+1h", offset: 60 },
              { label: "+3h", offset: 180 },
            ].map(({ label, offset }) => (
              <Button
                key={label}
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[10px] text-slate-400 hover:text-white hover:bg-violet-500/20"
                onClick={() => {
                  const newDate = new Date();
                  newDate.setMinutes(newDate.getMinutes() + offset);
                  newDate.setSeconds(0);
                  newDate.setMilliseconds(0);
                  onDateChange(newDate);
                }}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Separate components for just date or just time if needed
export function DatePicker({
  date,
  onDateChange,
  minDate,
  className,
  placeholder = "Pick a date",
}: Omit<DateTimePickerProps, "placeholder"> & { placeholder?: string }) {
  const [isOpen, setIsOpen] = React.useState(false);

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "w-full justify-start text-left font-normal",
            "bg-slate-800/50 border-white/10 hover:bg-slate-800 hover:border-white/20",
            !date && "text-slate-500",
            className
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4 text-violet-400" />
          {date ? format(date, "PPP") : <span>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" align="start">
        <Calendar
          mode="single"
          selected={date}
          onSelect={onDateChange}
          disabled={(d) => minDate ? d < new Date(minDate.setHours(0, 0, 0, 0)) : false}
          initialFocus
          classNames={{
            months: "flex flex-col",
            month: "space-y-3",
            caption: "flex justify-center pt-1 relative items-center",
            caption_label: "text-sm font-medium text-white",
            nav: "space-x-1 flex items-center",
            nav_button: cn(
              "h-7 w-7 bg-transparent p-0 text-slate-400 hover:text-white hover:bg-white/10 rounded-md transition-colors"
            ),
            nav_button_previous: "absolute left-1",
            nav_button_next: "absolute right-1",
            table: "w-full border-collapse space-y-1",
            head_row: "flex",
            head_cell: "text-slate-500 rounded-md w-8 font-normal text-[0.8rem]",
            row: "flex w-full mt-1",
            cell: cn(
              "relative p-0 text-center text-sm focus-within:relative focus-within:z-20",
              "first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md"
            ),
            day: cn(
              "h-8 w-8 p-0 font-normal rounded-md transition-colors",
              "text-slate-300 hover:bg-violet-500/20 hover:text-white",
              "focus:bg-violet-500/20 focus:text-white focus:outline-none"
            ),
            day_selected: "bg-violet-600 text-white hover:bg-violet-700 hover:text-white focus:bg-violet-700",
            day_today: "bg-slate-700 text-white",
            day_outside: "text-slate-600 opacity-50",
            day_disabled: "text-slate-600 opacity-50 cursor-not-allowed",
            day_hidden: "invisible",
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

interface TimePickerProps {
  time: { hour: number; minute: number } | undefined;
  onTimeChange: (time: { hour: number; minute: number }) => void;
  className?: string;
}

export function TimePicker({
  time,
  onTimeChange,
  className,
}: TimePickerProps) {
  const hours = React.useMemo(
    () => Array.from({ length: 24 }, (_, i) => i),
    []
  );

  const minutes = React.useMemo(
    () => Array.from({ length: 12 }, (_, i) => i * 5),
    []
  );

  const formatHour = (hour: number) => {
    const ampm = hour >= 12 ? "PM" : "AM";
    const displayHour = hour % 12 || 12;
    return `${displayHour}:00 ${ampm}`;
  };

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Clock className="h-4 w-4 text-violet-400" />

      <Select
        value={time?.hour?.toString()}
        onValueChange={(value) =>
          onTimeChange({ hour: parseInt(value), minute: time?.minute ?? 0 })
        }
      >
        <SelectTrigger className="w-24 h-9 bg-slate-800/50 border-white/10">
          <SelectValue placeholder="Hour" />
        </SelectTrigger>
        <SelectContent className="max-h-48 bg-slate-900/95 backdrop-blur-xl border-white/10">
          {hours.map((hour) => (
            <SelectItem
              key={hour}
              value={hour.toString()}
              className="hover:bg-violet-500/20 focus:bg-violet-500/20"
            >
              {formatHour(hour)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <span className="text-slate-500">:</span>

      <Select
        value={time?.minute?.toString()}
        onValueChange={(value) =>
          onTimeChange({ hour: time?.hour ?? 0, minute: parseInt(value) })
        }
      >
        <SelectTrigger className="w-16 h-9 bg-slate-800/50 border-white/10">
          <SelectValue placeholder="Min" />
        </SelectTrigger>
        <SelectContent className="bg-slate-900/95 backdrop-blur-xl border-white/10">
          {minutes.map((minute) => (
            <SelectItem
              key={minute}
              value={minute.toString()}
              className="hover:bg-violet-500/20 focus:bg-violet-500/20"
            >
              {minute.toString().padStart(2, "0")}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
