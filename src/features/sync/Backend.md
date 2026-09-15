 @GetMapping("/book/{bookId}/expired")
    public boolean isExpiredForBook(@PathVariable String bookId) {
        return service.isExpiredForBook(bookId);
    }